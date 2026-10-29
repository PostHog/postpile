import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeTelemetryProps, TELEMETRY_EVENTS, UNDO_WINDOW_MS, type ScoutCandidate, type TelemetryEventName } from '@postpile/core';
import { makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { GitHubError } from '@postpile/github';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';
import { FOLLOW_LOOKUP_MS } from './scout-actions.ts';

const LOOKOUT = '## Lookout\nrepos: acme/app\n\nNew top-level folders.\n';
const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(number: number, overrides: Partial<ScoutCandidate> = {}): ScoutCandidate {
  return {
    key: `acme/app#${number}`,
    nodeId: `PR_${number}`,
    title: `PR ${number}`,
    body: '',
    author: 'carol',
    assignees: [],
    isDraft: false,
    state: 'OPEN',
    headOid: `h${number}`,
    baseOid: 'base1',
    updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    mergedAt: null,
    ...overrides,
  };
}

/** A harness whose clock the test moves, with a first sync that pulls in `numbers` through the Lookout scout. */
async function pulled(options: { numbers?: number[]; writesEnabled?: boolean } = {}): Promise<{ h: Harness; later: (ms: number) => void }> {
  const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-')), 'scouts.md');
  writeFileSync(file, LOOKOUT);
  let now = NOW;
  const h = makeHarness({ scoutsFile: file, now: () => now, writesEnabled: options.writesEnabled ?? true });
  const numbers = options.numbers ?? [1];
  h.reader.scoutListings.set('acme/app', numbers.map((number) => candidate(number)));
  for (const number of numbers) {
    h.reader.scoutFileLists.set(`acme/app#${number}`, { headOid: `h${number}`, baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    h.reader.addStackPr(makePr({ number, headOid: `h${number}`, updatedAt: candidate(number).updatedAt }));
  }
  h.runner.answer('scout_judge', { judgements: numbers.map((number) => ({ prKey: `acme/app#${number}`, verdict: 'pull', reason: `adds billing/ (#${number})` })) });
  await h.engine.sync({});
  return { h, later: (ms) => (now = new Date(now.getTime() + ms)) };
}

function propsOf(h: Harness, event: TelemetryEventName): unknown[] {
  return h.telemetry.events.filter((entry) => entry.event === event).map((entry) => entry.props);
}

/** Every prop passes the catalogue and the leak guard unchanged. */
function expectSafe(h: Harness): void {
  for (const { event, props } of h.telemetry.events) {
    expect(TELEMETRY_EVENTS[event].safeParse(props).success, event).toBe(true);
    expect(sanitizeTelemetryProps(props as Record<string, unknown>)).toEqual(props);
  }
}

describe('scout_run_completed', () => {
  it('fires once per full sync with a scout in force, next to sync_completed, with the run counts', async () => {
    const { h } = await pulled({ numbers: [1, 2] });

    expect(propsOf(h, 'scout_run_completed')).toEqual([
      {
        scouts: 1,
        listed: 2,
        candidates: 2,
        judged: 2,
        pulled: 2,
        pending: 0,
        expired: 0,
        judge_calls: 1,
        capped: false,
        listing_capped: false,
        rate_limited: false,
        quota_low: false,
        duration_ms: 0,
      },
    ]);
    const names = h.telemetry.events.map((entry) => entry.event);
    expect(names.indexOf('scout_run_completed')).toBe(names.indexOf('sync_completed') + 1);

    await h.engine.sync({});
    expect(propsOf(h, 'scout_run_completed')).toHaveLength(2);
    // The cursor moved past both: nothing new to list or judge the second time.
    expect(propsOf(h, 'scout_run_completed')[1]).toMatchObject({ scouts: 1, listed: 0, candidates: 0, judged: 0, pulled: 0, judge_calls: 0 });
    expectSafe(h);
  });

  it('says rate_limited when GitHub throttles the refresh of scouted PRs', async () => {
    const { h } = await pulled();
    const limit = new GitHubError('GitHub POST graphql failed with 403: You have exceeded a secondary rate limit', 403, { rateLimited: true, retryAfterSeconds: 60 });
    vi.spyOn(h.reader, 'prUpdatedAts').mockRejectedValueOnce(limit);

    await h.engine.sync({});

    expect(propsOf(h, 'scout_run_completed')[1]).toMatchObject({ rate_limited: true });
  });

  it('says capped when the agent-call cap leaves candidates for the next sync', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-')), 'scouts.md');
    writeFileSync(file, LOOKOUT);
    const h = makeHarness({ scoutsFile: file });
    h.reader.scoutListings.set('acme/app', [candidate(1)]);
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(propsOf(h, 'scout_run_completed')[0]).toMatchObject({ candidates: 1, judged: 0, pending: 1, judge_calls: 0, capped: true });
  });

  it('says listing_capped when a resumed listing runs out of pages on the updates since it stopped', async () => {
    let now = NOW;
    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-')), 'scouts.md');
    writeFileSync(file, LOOKOUT);
    const h = makeHarness({ scoutsFile: file, now: () => now });
    h.reader.scoutPageSize = 1;
    const hour = 60 * 60 * 1000;
    const older = Array.from({ length: 12 }, (_, index) => candidate(index + 1, { updatedAt: new Date(NOW.getTime() - hour - index * 60_000).toISOString() }));
    h.reader.scoutListings.set('acme/app', older);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(propsOf(h, 'scout_run_completed')[0]).toMatchObject({ listing_capped: true });

    // More updates since the stop than one run's pages: the top pass is capped, and the resume point stays.
    const newer = Array.from({ length: 12 }, (_, index) => candidate(index + 20, { updatedAt: new Date(NOW.getTime() + 50 * 60_000 - index * 60_000).toISOString() }));
    h.reader.scoutListings.set('acme/app', [...newer, ...older]);
    now = new Date(NOW.getTime() + hour);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.meta.get('scout_listing_resume:acme/app')).not.toBeNull();
    expect(propsOf(h, 'scout_run_completed')[1]).toMatchObject({ listing_capped: true });
  });

  it('sends nothing without a scout in force', async () => {
    const h = makeHarness();
    await h.engine.sync({});
    expect(propsOf(h, 'scout_run_completed')).toEqual([]);

    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-')), 'scouts.md');
    writeFileSync(file, '');
    const empty = makeHarness({ scoutsFile: file });
    await empty.engine.sync({});
    expect(propsOf(empty, 'scout_run_completed')).toEqual([]);
  });
});

describe('scout_pr_closed', () => {
  it('fires once when a Follow reaches GitHub', async () => {
    const { h, later } = await pulled();
    await h.engine.markScoutedSeen('acme/app#1');
    later(2 * 60 * 60 * 1000);

    await h.engine.followScouted('acme/app#1', 'tile');
    expect(propsOf(h, 'scout_pr_closed')).toEqual([]);
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome: 'followed', was_seen: true, was_opened: true, hours_in_section: 2 }]);
    // A later sync, where it is tracked through its followed row, sends nothing more.
    await h.engine.sync({});
    expect(propsOf(h, 'scout_pr_closed')).toHaveLength(1);
    expectSafe(h);
  });

  it('fires once when a Follow from the lock goes through', async () => {
    const { h } = await pulled({ writesEnabled: false });
    await h.engine.followScouted('acme/app#1', 'detail');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();
    expect(propsOf(h, 'scout_pr_closed')).toEqual([]);

    await h.engine.setGitHubWrites(true);
    await h.engine.sendPendingWrites();

    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome: 'followed', was_seen: false, was_opened: false, hours_in_section: 0 }]);
  });

  it('fires once on dismiss, and never again when the PR later reaches the inbox', async () => {
    const { h } = await pulled();

    await h.engine.dismissScouted('acme/app#1', 'not ours');
    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome: 'dismissed', was_seen: false, was_opened: false, hours_in_section: 0 }]);

    const pr = makePr({ number: 1, headOid: 'h1', updatedAt: NOW.toISOString() });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.etag = 'etag-2';
    await h.engine.sync({});
    expect(propsOf(h, 'scout_pr_closed')).toHaveLength(1);
  });

  it('fires reached_inbox once when the PR gets a notification thread, not again when it would expire', async () => {
    const { h, later } = await pulled();
    later(5 * 60 * 60 * 1000);
    const pr = makePr({ number: 1, headOid: 'h1', updatedAt: candidate(1).updatedAt });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.etag = 'etag-2';

    await h.engine.sync({});

    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome: 'reached_inbox', was_seen: false, was_opened: false, hours_in_section: 5 }]);
    later(4 * DAY_MS);
    await h.engine.sync({});
    expect(propsOf(h, 'scout_pr_closed')).toHaveLength(1);
  });

  it('reports reached_inbox when a notification arrives in the same sync that would expire the PR', async () => {
    const { h, later } = await pulled();
    later(4 * DAY_MS);
    // No activity since the pull: the scout step would expire it as inactive, after the fetch stored its thread.
    const pr = makePr({ number: 1, headOid: 'h1', updatedAt: candidate(1).updatedAt });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.etag = 'etag-2';

    await h.engine.sync({});

    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome: 'reached_inbox', was_seen: false, was_opened: false, hours_in_section: 96 }]);
  });

  it('reports every scouted layer of a stack once one layer reaches the inbox, as the section reads it', async () => {
    const h = makeHarness();
    const bottom = makePr({ number: 5, headRef: 'billing-1', updatedAt: NOW.toISOString() });
    const top = makePr({ number: 6, baseRef: 'billing-1', headRef: 'billing-2', updatedAt: NOW.toISOString() });
    h.store.prs.upsert(bottom, NOW.toISOString());
    h.store.prs.upsert(top, NOW.toISOString());
    const row = { scoutId: 'lookout', scoutName: 'Lookout', configVersion: 1, reason: 'new folder', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null };
    h.store.scoutedPrs.insert({ ...row, prKey: bottom.key });
    h.store.scoutedPrs.insert({ ...row, prKey: top.key });
    h.reader.addPr(bottom, makeThreadFor(bottom));

    await h.engine.sync({});

    expect(await h.engine.listScouts()).toEqual([]);
    expect(propsOf(h, 'scout_pr_closed')).toEqual([
      { outcome: 'reached_inbox', was_seen: false, was_opened: false, hours_in_section: 0 },
      { outcome: 'reached_inbox', was_seen: false, was_opened: false, hours_in_section: 0 },
    ]);
  });

  it.each([
    ['expired_inactive', {}],
    ['expired_merged', { state: 'MERGED' as const, mergedAt: NOW.toISOString() }],
    ['expired_closed', { state: 'CLOSED' as const }],
  ])('fires %s once when the sync expires the PR', async (outcome, change) => {
    const { h, later } = await pulled();
    // The PR's last news on GitHub, seen by the next refresh.
    h.reader.addStackPr(makePr({ number: 1, headOid: 'h1', updatedAt: NOW.toISOString(), ...change }));
    later(4 * DAY_MS);

    await h.engine.sync({});

    expect(propsOf(h, 'scout_pr_closed')).toEqual([{ outcome, was_seen: false, was_opened: false, hours_in_section: 96 }]);
    expect(propsOf(h, 'scout_run_completed')[1]).toMatchObject({ expired: 1 });
    await h.engine.sync({});
    expect(propsOf(h, 'scout_pr_closed')).toHaveLength(1);
    expectSafe(h);
  });
});

describe('follow reliability', () => {
  it('reports a failed or empty PR lookup, and one past its deadline', async () => {
    const { h } = await pulled();
    h.reader.failNodeIdLookup = new Error('GitHub API rate limit exceeded');
    await h.engine.followScouted('acme/app#1', 'tile');
    h.reader.failNodeIdLookup = null;
    vi.spyOn(h.reader, 'scoutPrNodeId').mockResolvedValueOnce(null);
    await h.engine.followScouted('acme/app#1', 'tile');
    vi.spyOn(h.reader, 'scoutPrNodeId').mockImplementationOnce(() => new Promise(() => {}));
    const stalled = h.engine.followScouted('acme/app#1', 'tile');
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await stalled;

    expect(propsOf(h, 'scout_follow_failed')).toEqual([{ stage: 'lookup' }, { stage: 'lookup' }, { stage: 'timeout' }]);
    expect(propsOf(h, 'scout_followed')).toEqual([]);
  });

  it('reports a subscription GitHub refused', async () => {
    const { h } = await pulled();
    h.writer.failFollow = true;
    await h.engine.followScouted('acme/app#1', 'tile');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(propsOf(h, 'scout_follow_failed')).toEqual([{ stage: 'subscribe' }]);
    expect(propsOf(h, 'scout_pr_closed')).toEqual([]);
  });

  it('reports a subscription past its deadline, then its late success and the PR leaving once', async () => {
    const { h } = await pulled();
    let answer: () => void = () => {};
    const subscribe = vi.spyOn(h.writer, 'followPr').mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    await h.engine.followScouted('acme/app#1', 'tile');
    const flushed = h.engine.flushPendingWrites();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await flushed;
    expect(propsOf(h, 'scout_follow_failed')).toEqual([{ stage: 'timeout' }]);

    answer();

    await vi.waitFor(() => expect(propsOf(h, 'scout_follow_late_success')).toEqual([{}]));
    expect(propsOf(h, 'scout_pr_closed')).toMatchObject([{ outcome: 'followed' }]);
  });
});

describe('scout_seen', () => {
  it('fires on open only when the seen boundary moves', async () => {
    const { h } = await pulled();

    await h.engine.markScoutedSeen('acme/app#1');
    await h.engine.markScoutedSeen('acme/app#1');

    expect(propsOf(h, 'scout_seen')).toEqual([{ via: 'open' }]);
  });

  it('fires for an outside agent marking a scouted PR seen', async () => {
    const { h } = await pulled();
    const seenThrough = (await h.engine.getPr('acme/app#1'))!.seenThrough;

    await h.engine.markReadForAgent({ prs: [{ prKey: 'acme/app#1', seenThrough }] }, { client: 'claude-code' });

    expect(propsOf(h, 'scout_seen')).toEqual([{ via: 'mcp' }]);
  });
});

describe('active_scouts', () => {
  it('never fails a sync over an unreadable scouts.md', async () => {
    // A folder where scouts.md should be: every read of it throws.
    const folder = mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-'));
    const h = makeHarness({ scoutsFile: folder });
    h.reader.who = { ...viewer, databaseId: 4242 };

    const report = await h.engine.sync({});

    expect(report.finishedAt).not.toBe('');
    expect(h.telemetry.events.map((entry) => entry.event)).toContain('sync_completed');
    // The read threw inside the identity report, which logged it and moved on.
    expect(h.telemetry.personInfo).toEqual([]);
  });

  it('sets the count of scouts in force on the person after each sync', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-telemetry-')), 'scouts.md');
    writeFileSync(file, `${LOOKOUT}\n## Billing\nrepos: acme/app, acme/api\n\nBilling changes.\n`);
    const h = makeHarness({ scoutsFile: file });
    h.reader.who = { ...viewer, databaseId: 4242 };

    await h.engine.sync({});

    expect(h.telemetry.personInfo.at(-1)).toMatchObject({ activeScouts: 2 });
  });
});
