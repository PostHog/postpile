import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScoutCandidate, ScoutFile } from '@postpile/core';
import { makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';

const LOOKOUT = `## Lookout
repos: acme/app
paths: +*/, docs/architecture.md

New top-level folders and architecture changes.
`;

function scoutsFile(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-run-')), 'scouts.md');
  writeFileSync(file, text);
  return file;
}

function hoursAgo(hours: number, from: Date = NOW): string {
  return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
}

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
    updatedAt: hoursAgo(1),
    mergedAt: null,
    ...overrides,
  };
}

/** Lists the PR, gives it files and a full snapshot on the fake GitHub. */
function onGitHub(h: Harness, pr: ScoutCandidate, files: ScoutFile[]): void {
  const listing = h.reader.scoutListings.get('acme/app') ?? [];
  h.reader.scoutListings.set('acme/app', [...listing.filter((other) => other.key !== pr.key), pr].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  h.reader.scoutFileLists.set(pr.key, { headOid: pr.headOid, baseOid: pr.baseOid, foldersOid: pr.baseOid, files });
  const number = Number(pr.key.split('#')[1]);
  h.reader.addStackPr(makePr({ number, title: pr.title, author: pr.author, headOid: pr.headOid, updatedAt: pr.updatedAt }));
}

function setup(text = LOOKOUT, now: () => Date = () => NOW): Harness {
  const h = makeHarness({ scoutsFile: scoutsFile(text), now });
  h.reader.scoutTrees.set('base1', ['src', 'docs']);
  return h;
}

function pulls(h: Harness, ...answers: [number, 'pull' | 'skip', string][]): void {
  h.runner.answer('scout_judge', { judgements: answers.map(([number, verdict, reason]) => ({ prKey: `acme/app#${number}`, verdict, reason })) });
}

describe('the scout step of a full sync', () => {
  it('pulls a matching PR in untracked, glances it, and advances the cursor', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    onGitHub(h, candidate(2), [{ path: 'src/app.ts', changeType: 'MODIFIED' }]);
    pulls(h, [1, 'pull', 'adds a new top-level folder billing/']);

    const report = await h.engine.sync({});

    expect(report.errors).toEqual([]);
    expect(h.store.scoutedPrs.listActive()).toMatchObject([{ prKey: 'acme/app#1', scoutId: 'lookout', scoutName: 'Lookout', reason: 'adds a new top-level folder billing/', configVersion: 1 }]);
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'judged', verdict: 'pulled', attempts: 1 });
    // No path hint matched: skipped by rule, never in the prompt.
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#2')).toMatchObject({ status: 'judged', verdict: 'skipped', reason: 'no path signal', attempts: 0 });
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(1);
    expect(h.runner.promptsFor('scout_judge')[0]).not.toContain('acme/app#2');
    expect(h.store.prs.get('acme/app#1')).not.toBeNull();
    expect(h.store.glances.get('acme/app#1')).toMatchObject({ prKey: 'acme/app#1' });
    expect(report.agentCallStats.byKind.scout_judge?.calls).toBe(1);
    expect(h.store.scoutCursors.get('lookout', 'acme/app')?.coveredThrough).toBe(NOW.toISOString());
    // Not tracked: no tile, no topic, nothing unread.
    expect(await h.engine.listTopics()).toEqual([]);
    expect(await h.engine.getTopic('unsorted')).toMatchObject({ tiles: [] });
  });

  it('leaves out drafts, dependency bots, the user, teammates and PRs already in the inbox', async () => {
    const h = setup();
    const added: ScoutFile[] = [{ path: 'billing/main.ts', changeType: 'ADDED' }];
    onGitHub(h, candidate(1, { isDraft: true }), added);
    onGitHub(h, candidate(2, { author: 'dependabot[bot]' }), added);
    onGitHub(h, candidate(3, { author: viewer.login }), added);
    onGitHub(h, candidate(4), added);
    const inbox = makePr({ number: 4 });
    h.reader.addPr(inbox, makeThreadFor(inbox));

    await h.engine.sync({});

    expect(h.runner.promptsFor('scout_judge')).toEqual([]);
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('files'))).toEqual([]);
    expect(h.store.scoutedPrs.listAll()).toEqual([]);
  });

  it('reads nothing again for a PR whose head did not move', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'skip', 'only a fixture folder']);
    await h.engine.sync({});
    onGitHub(h, candidate(1, { updatedAt: hoursAgo(1 / 60) }), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    const filesBefore = h.reader.scoutCalls.filter((call) => call.startsWith('files')).length;

    await h.engine.sync({});

    expect(h.reader.scoutCalls.filter((call) => call.startsWith('files')).length).toBe(filesBefore);
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(1);
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ verdict: 'skipped', observedUpdatedAt: hoursAgo(1 / 60) });
  });

  it('judges again after a push that adds a matching file', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'skip', 'fixtures only']);
    await h.engine.sync({});
    onGitHub(h, candidate(1, { headOid: 'h1b', updatedAt: hoursAgo(1 / 60) }), [
      { path: 'billing/main.ts', changeType: 'ADDED' },
      { path: 'docs/architecture.md', changeType: 'MODIFIED' },
    ]);
    pulls(h, [1, 'pull', 'now changes the architecture doc too']);

    await h.engine.sync({});

    expect(h.runner.promptsFor('scout_judge')).toHaveLength(2);
    expect(h.store.scoutedPrs.get('acme/app#1')).toMatchObject({ reason: 'now changes the architecture doc too' });
  });

  it('keeps PRs the answer left out pending and retries them next sync, past the cursor', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    onGitHub(h, candidate(2), [{ path: 'payments/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'skip', 'fixtures only']);
    await h.engine.sync({});

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#2')).toMatchObject({ status: 'pending', lastError: 'left out of the answer', attempts: 1 });
    // Covered anyway: the pending row is durable.
    expect(h.store.scoutCursors.get('lookout', 'acme/app')?.coveredThrough).toBe(NOW.toISOString());

    // A day later the listing stops before #2; the pending row still brings it back.
    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    h.reader.scoutListings.set('acme/app', [candidate(3, { updatedAt: hoursAgo(1, now) }), candidate(2)]);
    h.reader.scoutPageSize = 1;
    pulls(h, [2, 'pull', 'adds payments/']);
    await h.engine.sync({});

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#2')).toMatchObject({ status: 'judged', verdict: 'pulled', attempts: 2 });
    expect(h.reader.scoutCalls).toContain('numbers acme/app#2');
  });

  it('judges a draft that was marked ready without a push, after a rule had left it out', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    const files: ScoutFile[] = [{ path: 'billing/main.ts', changeType: 'ADDED' }];
    onGitHub(h, candidate(1), files);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'pending' });

    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    onGitHub(h, candidate(1, { isDraft: true, updatedAt: hoursAgo(0.5, now) }), files);
    await h.engine.sync({});
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'judged', verdict: 'skipped', leftOut: 'draft' });

    // Ready for review: same head, same scouts.md, only the draft flag moved.
    now = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    onGitHub(h, candidate(1, { updatedAt: hoursAgo(0.5, now) }), files);
    pulls(h, [1, 'pull', 'adds billing/']);
    await h.engine.sync({});

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'judged', verdict: 'pulled', leftOut: null });
    expect(h.store.scoutedPrs.get('acme/app#1')).not.toBeNull();
  });

  it('leaves work pending at the agent-call cap and still covers the window', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'pending', lastError: 'stopped at the agent-call cap', attempts: 0 });
    // Nothing read from GitHub for work no call could judge.
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('files'))).toEqual([]);
    expect(report.agentCallStats.byKind.scout_judge?.skippedByBudget).toBe(1);
    expect(h.store.scoutCursors.get('lookout', 'acme/app')).not.toBeNull();
  });

  it('keeps a candidate pending while its file list is not whole', async () => {
    const h = setup();
    onGitHub(h, candidate(1), []);
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base1', foldersOid: 'base1', files: null });

    await h.engine.sync({});

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ status: 'pending', lastError: 'file list not read whole' });
    expect(h.runner.promptsFor('scout_judge')).toEqual([]);
  });

  it('does not move the cursor when the listing fails', async () => {
    const h = setup();
    h.reader.failingScoutRepos.add('acme/app');

    const report = await h.engine.sync({});

    expect(report.errors).toEqual(['scouts: listing acme/app: GitHub scout listing of acme/app failed']);
    expect(h.store.scoutCursors.get('lookout', 'acme/app')).toBeNull();
  });

  it('lets the first scout in the file own a PR another scout would pull too', async () => {
    const h = setup(`${LOOKOUT}\n## Billing\nrepos: acme/app\n\nAnything about billing.\n`);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'pull', 'new folder billing/']);
    pulls(h, [1, 'pull', 'billing service']);

    await h.engine.sync({});

    expect(h.store.scoutedPrs.listAll()).toMatchObject([{ prKey: 'acme/app#1', scoutId: 'lookout' }]);
    expect(h.store.scoutJudgements.get('billing', 'acme/app#1')).toMatchObject({ verdict: 'pulled', reason: 'billing service' });
  });

  it('glances a scouted PR that is already merged, and again after its merge', async () => {
    const h = setup();
    onGitHub(h, candidate(1, { state: 'MERGED', mergedAt: hoursAgo(1) }), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    h.reader.addStackPr(makePr({ number: 1, state: 'MERGED', mergedAt: hoursAgo(1), headOid: 'h1', updatedAt: hoursAgo(1) }));
    pulls(h, [1, 'pull', 'new folder billing/']);
    await h.engine.sync({});
    expect(h.store.glances.get('acme/app#1')).not.toBeNull();
  });

  it('expires a scouted PR three days without activity', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'pull', 'new folder billing/']);
    await h.engine.sync({});

    now = new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000);
    await h.engine.sync({});

    expect(h.store.scoutedPrs.listActive()).toEqual([]);
    expect(h.store.scoutedPrs.get('acme/app#1')).toMatchObject({ expiryReason: 'inactive' });
  });

  it('keeps the last valid scouts in force when the file breaks, and says so', async () => {
    const file = scoutsFile(LOOKOUT);
    const h = makeHarness({ scoutsFile: file });
    await h.engine.sync({});
    writeFileSync(file, '## Lookout\nrepos: nope\n\nbroken\n');

    const report = await h.engine.sync({});

    expect(report.errors).toEqual(['scouts.md: line 2: repo "nope" is not owner/name; scouts from version 1 run until it is fixed']);
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('list'))).toHaveLength(2);
  });

  it('runs no scouts without a scouts file', async () => {
    const h = makeHarness();
    await h.engine.sync({});
    expect(h.reader.scoutCalls).toEqual([]);
  });

  it('reads the files again after a scouts.md edit, and judges again only when this scout changed', async () => {
    const file = scoutsFile(LOOKOUT);
    const h = makeHarness({ scoutsFile: file });
    h.reader.scoutTrees.set('base1', ['src', 'docs']);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'skip', 'fixtures only']);
    await h.engine.sync({});

    // Another scout added: this scout is unchanged, so no new call for it.
    writeFileSync(file, `${LOOKOUT}\n## Other\nrepos: acme/web\n\nx\n`);
    onGitHub(h, candidate(1, { updatedAt: hoursAgo(1 / 60) }), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    await h.engine.sync({});
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(1);

    // This scout's prompt edited: judged again under it.
    writeFileSync(file, LOOKOUT.replace('New top-level folders', 'Any new folders'));
    onGitHub(h, candidate(1, { updatedAt: hoursAgo(1 / 120) }), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'pull', 'a new folder billing/']);
    await h.engine.sync({});
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(2);
    expect(h.store.scoutedPrs.get('acme/app#1')).not.toBeNull();
  });

  it('goes on below where a capped listing stopped, instead of reading the top again', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    h.reader.scoutPageSize = 1;
    const many = Array.from({ length: 12 }, (_, index) => candidate(index + 1, { updatedAt: hoursAgo(1 + index / 60) }));
    h.reader.scoutListings.set('acme/app', many);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.scoutCursors.get('lookout', 'acme/app')).toBeNull();
    expect(h.store.meta.get('scout_listing_resume:acme/app')).not.toBeNull();
    // Stored with the point: every PR above it has a row, so nothing is lost below a crash.
    expect(h.store.scoutJudgements.listPending('lookout')).toHaveLength(10);

    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    const calls = h.reader.scoutCalls.length;
    await h.engine.sync({ maxAgentCalls: 0 });

    const listed = h.reader.scoutCalls.slice(calls).filter((call) => call.startsWith('list'));
    // The top page (nothing new since), then pages 10 and 11 below the stop.
    expect(listed).toEqual(['list acme/app -', 'list acme/app 10', 'list acme/app 11']);
    expect(h.store.scoutCursors.get('lookout', 'acme/app')?.coveredThrough).toBe(now.toISOString());
    expect(h.store.meta.get('scout_listing_resume:acme/app')).toBeNull();
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#12')).not.toBeNull();
  });

  it('lists from the top again when a scout joined the repo after a capped listing', async () => {
    let now = NOW;
    const file = scoutsFile(LOOKOUT);
    const h = makeHarness({ scoutsFile: file, now: () => now });
    h.reader.scoutTrees.set('base1', ['src', 'docs']);
    h.reader.scoutPageSize = 1;
    h.reader.scoutListings.set('acme/app', Array.from({ length: 12 }, (_, index) => candidate(index + 1, { updatedAt: hoursAgo(1 + index / 60) })));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(JSON.parse(h.store.meta.get('scout_listing_resume:acme/app')!)).toMatchObject({ after: '10', scouts: ['lookout'] });

    writeFileSync(file, `${LOOKOUT}\n## Billing\nrepos: acme/app\n\nAnything about billing.\n`);
    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    const calls = h.reader.scoutCalls.length;
    await h.engine.sync({ maxAgentCalls: 0 });

    // Billing never saw the top pages: no jump to the stored point.
    const listed = h.reader.scoutCalls.slice(calls).filter((call) => call.startsWith('list'));
    expect(listed.slice(0, 3)).toEqual(['list acme/app -', 'list acme/app 1', 'list acme/app 2']);
    expect(h.store.scoutJudgements.listPending('billing').map((row) => row.prKey)).toContain('acme/app#1');
    expect(JSON.parse(h.store.meta.get('scout_listing_resume:acme/app')!)).toMatchObject({ scouts: ['billing', 'lookout'] });
  });

  it("keeps a first scan's window when it resumes the next day", async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    h.reader.scoutPageSize = 1;
    // 12 PRs over the first day's 24 hours; the scan stops after 10 pages.
    h.reader.scoutListings.set('acme/app', Array.from({ length: 12 }, (_, index) => candidate(index + 1, { updatedAt: hoursAgo(1 + index * 2) })));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(JSON.parse(h.store.meta.get('scout_listing_resume:acme/app')!)).toMatchObject({ floor: hoursAgo(24) });

    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await h.engine.sync({ maxAgentCalls: 0 });

    // #12 was updated 23 h before the first run: inside that run's window, though older than "24 h before" the second.
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#12')).not.toBeNull();
    expect(h.store.scoutCursors.get('lookout', 'acme/app')?.coveredThrough).toBe(now.toISOString());
  });

  it('never expires a scouted PR on a snapshot the refresh could not check', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'pull', 'new folder billing/']);
    await h.engine.sync({});

    now = new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000);
    h.reader.prs.delete('acme/app#1');
    await h.engine.sync({});

    expect(h.store.scoutedPrs.listActive().map((row) => row.prKey)).toEqual(['acme/app#1']);
  });

  it('makes at most 5 judge calls per sync, whatever its cap, and leaves the rest pending', async () => {
    const h = setup();
    for (let number = 1; number <= 70; number++) {
      onGitHub(h, candidate(number), [{ path: `svc${number}/main.ts`, changeType: 'ADDED' }]);
    }
    const skipAll = { judgements: Array.from({ length: 70 }, (_, index) => ({ prKey: `acme/app#${index + 1}`, verdict: 'skip', reason: 'not it' })) };
    for (let call = 0; call < 5; call++) {
      h.runner.answer('scout_judge', skipAll);
    }
    await h.engine.sync({});
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(5);
    const waiting = h.store.scoutJudgements.listPending('lookout').filter((row) => row.lastError === 'waits for the next sync (more candidates than scout calls)');
    expect(waiting).toHaveLength(10);
    // Their files are not read: only the 60 the calls can judge.
    const read = h.reader.scoutCalls.filter((call) => call.startsWith('files')).flatMap((call) => call.slice('files '.length).split(','));
    expect(read).toHaveLength(60);
    expect(read).not.toContain(waiting[0]!.prKey);

    // The next sync takes the waiting retries first.
    h.runner.answer('scout_judge', skipAll);
    await h.engine.sync({});
    const nextPrompt = h.runner.promptsFor('scout_judge')[5]!;
    expect(waiting.every((row) => nextPrompt.includes(`=== ${row.prKey}\n`))).toBe(true);
  });

  it('puts retries whose file lists keep failing behind new work, so they never hold every slot', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    for (let number = 1; number <= 60; number++) {
      onGitHub(h, candidate(number), []);
      h.reader.scoutFileLists.set(`acme/app#${number}`, { headOid: `h${number}`, baseOid: 'base1', foldersOid: 'base1', files: null });
    }
    await h.engine.sync({});
    expect(h.store.scoutJudgements.listPending('lookout').filter((row) => row.lastError === 'file list not read whole')).toHaveLength(60);

    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    onGitHub(h, candidate(61, { updatedAt: hoursAgo(0.5, now) }), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [61, 'pull', 'adds billing/']);
    await h.engine.sync({});

    expect(h.store.scoutJudgements.get('lookout', 'acme/app#61')).toMatchObject({ status: 'judged', verdict: 'pulled' });
  });

  it('finds a new top-level folder on a PR merged before the scout saw it, against the tree before the merge', async () => {
    const h = setup();
    const merged = candidate(1, { state: 'MERGED', mergedAt: hoursAgo(2), baseOid: 'base-after' });
    onGitHub(h, merged, [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base-after', foldersOid: 'before-merge', files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    // The base branch holds billing/ once merged; the commit before the merge does not.
    h.reader.scoutTrees.set('base-after', ['src', 'docs', 'billing']);
    h.reader.scoutTrees.set('before-merge', ['src', 'docs']);
    pulls(h, [1, 'pull', 'adds billing/']);

    await h.engine.sync({});

    expect(h.runner.promptsFor('scout_judge')).toHaveLength(1);
    expect(h.store.scoutJudgements.get('lookout', 'acme/app#1')).toMatchObject({ verdict: 'pulled' });
  });

  it('looks pending PRs up by number only as far as this run can judge them, and not at all without calls', async () => {
    let now = NOW;
    const h = setup(LOOKOUT, () => now);
    for (let number = 1; number <= 70; number++) {
      onGitHub(h, candidate(number), [{ path: `svc${number}/main.ts`, changeType: 'ADDED' }]);
    }
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.scoutJudgements.listPending('lookout')).toHaveLength(70);

    // A day later the listing no longer reaches them: they need a lookup by number.
    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const listed = h.reader.scoutListings.get('acme/app')!;
    h.reader.scoutListings.set('acme/app', []);
    h.reader.scoutCalls.length = 0;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('numbers'))).toEqual([]);

    const lookups: string[] = [];
    vi.spyOn(h.reader, 'scoutPrsByNumber').mockImplementation(async (refs) => {
      const wanted = new Set(refs.map((ref) => `${ref.repo}#${ref.number}`));
      lookups.push(...wanted);
      return new Map(listed.filter((pr) => wanted.has(pr.key)).map((pr) => [pr.key, pr]));
    });
    for (let call = 0; call < 5; call++) {
      h.runner.answer('scout_judge', { judgements: [] });
    }
    await h.engine.sync({});
    // Five calls of twelve: 60 looked up, the other 10 wait unread.
    expect(lookups).toHaveLength(60);
  });

  it('runs no scout work when the sync asks for other agent jobs only', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    await h.engine.sync({ agentJobs: ['topics'] });
    expect(h.reader.scoutCalls).toEqual([]);
  });

  it('reads a file list once for every scout on the repo', async () => {
    const h = setup(`${LOOKOUT}\n## Billing\nrepos: acme/app\n\nAnything about billing.\n`);
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    pulls(h, [1, 'skip', 'no']);
    pulls(h, [1, 'skip', 'no']);
    await h.engine.sync({});
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('files'))).toEqual(['files acme/app#1']);
  });

  it('stops reading GitHub once the quota runs low, leaving the window uncovered', async () => {
    const h = setup();
    onGitHub(h, candidate(1), [{ path: 'billing/main.ts', changeType: 'ADDED' }]);
    let reads = 0;
    h.reader.onListScoutPrs = () => {
      reads += 1;
      h.quota.note({ resource: 'graphql', limit: 5000, remaining: 10, resetAtMs: h.timers.now() + 3600_000 });
    };
    await h.engine.sync({});
    expect(reads).toBe(1);
    expect(h.reader.scoutCalls.filter((call) => call.startsWith('files'))).toEqual([]);
  });
});

