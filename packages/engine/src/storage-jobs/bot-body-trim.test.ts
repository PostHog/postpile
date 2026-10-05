// Bot bodies cut when saved (DESIGN.md "Bot bodies are cut when saved"):
// storage job 1 cuts what is stored, in small slices, and a deploy event
// that a cut body no longer explains keeps its state wherever its PR's
// events are derived again.
import { deriveEvents, eventId, trimBotBodies, trimBotBody, UNDO_WINDOW_MS, type Pr } from '@postpile/core';
import { at, FakeTimers, makeComment, makeEvent, makePr, makeReview, makeThread, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';
import { BOT_BODY_TRIM_AFTER_KEY, BOT_BODY_TRIM_DONE_KEY, BotBodyTrimJob } from './bot-body-trim.ts';
import { START_DELAY_MS, StorageJobRunner, type StorageJobReport } from './runner.ts';

const BOT = 'github-actions[bot]';

/** A long generated report that names a deploy preview only far past the cut. */
const LATE_DEPLOY = `## Test report\n${'- a passing test with a long generated name\n'.repeat(160)}\nPreview deployed to https://preview.example.com`;
const CUT = trimBotBody({ author: BOT, body: LATE_DEPLOY });

/** A PR with the long report as a comment, an inline comment and a review, plus a person's long comment. */
function reportPr(number: number, overrides: Partial<Pr> = {}): Pr {
  const inline = makeComment({ id: `rc${number}`, author: BOT, body: LATE_DEPLOY, createdAt: at(11) });
  return makePr({
    number,
    body: LATE_DEPLOY,
    comments: [
      makeComment({ id: `c${number}`, author: BOT, body: LATE_DEPLOY }),
      makeComment({ id: `h${number}`, author: 'alice', body: 'a long human note\n'.repeat(300) }),
      { ...inline, kind: 'review_comment', threadId: `t${number}`, path: 'a.ts' },
    ],
    threads: [makeThread(`t${number}`, [inline])],
    reviews: [makeReview({ id: `r${number}`, author: BOT, state: 'COMMENTED', body: LATE_DEPLOY })],
    ...overrides,
  });
}

/**
 * The comment's event as a build before the cut stored it: the whole body
 * said "deploy". Seen, muted by the user and logged.
 */
function storeOldDeployEvent(store: Store, pr: Pr): string {
  const id = eventId(pr.key, 'deploy', `c${pr.ref.number}`);
  store.events.upsertDerived(pr.key, [makeEvent({ id, prKey: pr.key, kind: 'deploy', actor: BOT, isBot: true, sourceId: `c${pr.ref.number}`, at: at(10) })]);
  store.events.markSeen([id], at(30));
  store.events.setOverride(id, { loudness: 'muted', reason: 'preview noise', by: 'user' });
  store.eventLog.append([{ id, prKey: pr.key }], at(2));
  return id;
}

function revisionOf(store: Store, key: string): number {
  return (store.db.prepare('SELECT snapshot_revision FROM pr WHERE key = ?').get(key) as { snapshot_revision: number }).snapshot_revision;
}

describe('the bot body trim job', () => {
  let store: Store;
  let timers: FakeTimers;
  let busy: boolean;
  let lines: string[];
  let reports: StorageJobReport[];

  beforeEach(() => {
    store = Store.open(':memory:');
    timers = new FakeTimers();
    busy = false;
    lines = [];
    reports = [];
  });

  afterEach(() => {
    store.close();
  });

  /** The runner with only the trim, one PR per slice. */
  function trimRunner(): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs: [new BotBodyTrimJob()],
      now: () => NOW,
      timers,
      busy: () => busy,
      log: (line) => lines.push(line),
      onDone: (report) => reports.push(report),
      sliceBudgetMs: 0,
    });
  }

  /** Runs timers until the job is done or `limit` ms passed. */
  function runFor(limit: number): void {
    for (let passed = 0; passed < limit && store.meta.get(BOT_BODY_TRIM_DONE_KEY) === null; passed += 10) {
      timers.advance(10);
    }
  }

  it('cuts every stored copy of a bot body, keeps people, the description and fetched_at, and marks itself done', () => {
    const pr = reportPr(1);
    store.prs.upsert(pr, at(1));

    trimRunner().start();
    runFor(60_000);

    const stored = store.prs.get(pr.key)!;
    expect(stored.comments.map((comment) => comment.body)).toEqual([CUT, pr.comments[1]!.body, CUT]);
    expect(stored.threads[0]!.comments[0]!.body).toBe(CUT);
    expect(stored.reviews[0]!.body).toBe(CUT);
    expect(stored.body).toBe(LATE_DEPLOY);
    expect(store.prs.fetchedAt(pr.key)).toBe(at(1));
    expect(store.meta.get(BOT_BODY_TRIM_DONE_KEY)).toBe(NOW.toISOString());
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBeNull();
    expect(lines).toEqual([expect.stringMatching(/^storage job bot_body_trim done: 1 of 1 units rewritten, work \d+ ms, longest slice \d+ ms, wall \d+ ms$/)]);
    expect(reports).toMatchObject([{ name: 'bot_body_trim', units: 1, wrote: 1 }]);
  });

  it('waits after start, and while foreground work runs', () => {
    store.prs.upsert(reportPr(1), at(1));
    trimRunner().start();
    timers.advance(START_DELAY_MS - 1_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);

    busy = true;
    timers.advance(10_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);

    busy = false;
    runFor(10_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(CUT);
  });

  it('goes a PR per unit, moving the cursor only past PRs done, and the revision only of PRs it cut', () => {
    store.prs.upsert(reportPr(1), at(1));
    store.prs.upsert(makePr({ number: 2, comments: [makeComment({ id: 'c2', author: BOT, body: 'short' })] }), at(1));
    store.prs.upsert(reportPr(3), at(1));
    const before = [1, 2, 3].map((number) => revisionOf(store, `acme/app#${number}`));
    const runner = trimRunner();

    expect(runner.slice()).toBe('worked');
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#1');
    expect(store.prs.get('acme/app#3')!.comments[0]!.body).toBe(LATE_DEPLOY);
    expect(runner.slice()).toBe('worked');
    expect(runner.slice()).toBe('worked');
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#3');
    expect(runner.slice()).toBe('worked');
    expect(store.meta.get(BOT_BODY_TRIM_DONE_KEY)).not.toBeNull();
    expect(runner.slice()).toBe('idle');

    const after = [1, 2, 3].map((number) => revisionOf(store, `acme/app#${number}`));
    expect(after[0]).toBeGreaterThan(before[2]!);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBeGreaterThan(after[0]!);
    expect(reports).toMatchObject([{ units: 3, wrote: 2 }]);
  });

  it('resumes after the last slice when stopped, and runs once', () => {
    for (const number of [1, 2, 3]) {
      store.prs.upsert(reportPr(number), at(1));
    }
    const first = trimRunner();
    first.start();
    timers.advance(START_DELAY_MS);
    first.stop();
    timers.advance(60_000);
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#1');
    expect(store.prs.get('acme/app#3')!.comments[0]!.body).toBe(LATE_DEPLOY);

    trimRunner().start();
    runFor(60_000);
    expect(store.prs.listAll().every((pr) => pr.comments[0]!.body === CUT)).toBe(true);
    expect(lines.at(-1)).toMatch(/done: 2 of 2 units rewritten/);

    store.prs.upsert(reportPr(4), at(5));
    trimRunner().start();
    timers.advance(120_000);
    expect(store.prs.get('acme/app#4')!.comments[0]!.body).toBe(LATE_DEPLOY);
  });

  it('goes on from the cursor 0.19.0 left in meta, under the same keys', () => {
    for (const number of [1, 2, 3]) {
      store.prs.upsert(reportPr(number), at(1));
    }
    // 0.19.0's BotBodyTrim got through #1 and quit. (#1 stays uncut here, to show it is not read again.)
    store.meta.set('bot_body_trim_after', 'acme/app#1');

    trimRunner().start();
    runFor(60_000);

    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);
    expect(store.prs.get('acme/app#2')!.comments[0]!.body).toBe(CUT);
    expect(store.prs.get('acme/app#3')!.comments[0]!.body).toBe(CUT);
    expect(store.meta.get('bot_body_trim_done')).toBe(NOW.toISOString());
    expect(store.meta.get('bot_body_trim_after')).toBeNull();
    expect(reports).toMatchObject([{ units: 2, wrote: 2 }]);
  });

  it('never runs again on an install where 0.19.0 finished it', () => {
    store.prs.upsert(reportPr(1), at(1));
    store.meta.set('bot_body_trim_done', at(0));

    const runner = trimRunner();
    runner.start();
    timers.advance(120_000);

    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);
    expect(runner.slice()).toBe('idle');
    expect(lines).toEqual([]);
  });

  it('leaves events as they are: the next derive moves them (EventRepo)', () => {
    const pr = reportPr(1);
    store.prs.upsert(pr, at(1));
    const old = storeOldDeployEvent(store, pr);
    const before = store.events.listForPr(pr.key);

    trimRunner().start();
    runFor(60_000);

    expect(store.events.listForPr(pr.key)).toEqual(before);
    expect(before.map((event) => event.id)).toEqual([old]);
  });

  it('keeps a bot comment a person edited last whole', () => {
    const edited = makeComment({ id: 'c1', author: BOT, editor: 'alice', body: `${LATE_DEPLOY}\ncc @viewer`, lastEditedAt: at(40) });
    const pr = makePr({ comments: [edited] });
    store.prs.upsert(pr, at(1));

    trimRunner().start();
    runFor(60_000);

    expect(store.prs.get(pr.key)).toEqual(pr);
    expect(lines.at(-1)).toMatch(/done: 0 of 1 units rewritten/);
  });
});

describe('a deploy event the cut body no longer explains', () => {
  it('keeps its seen time, the user override and its log seq when a fetch reaches the PR before the job', async () => {
    let now = NOW;
    const h = makeHarness({ now: () => now });
    const old = reportPr(1, { updatedAt: at(0) });
    h.store.prs.upsert(old, at(1));
    const oldId = storeOldDeployEvent(h.store, old);
    const seq = h.store.eventLog.listSince([old.key], 0).find((entry) => entry.event.id === oldId)!.seq;

    // GitHub has news on the PR; the fetch stores it cut (normalize.ts does it in the app).
    now = new Date(NOW.getTime() + 3_600_000);
    const fresh = trimBotBodies({ ...old, updatedAt: now.toISOString() });
    h.reader.addPr(fresh, makeThreadFor(fresh, { updatedAt: now.toISOString() }));
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([]);

    const events = h.store.events.listForPr(old.key).filter((event) => event.sourceId === 'c1');
    expect(events).toMatchObject([{ id: eventId(old.key, 'bot_comment', 'c1'), seenAt: at(30), override: { loudness: 'muted', reason: 'preview noise', by: 'user' } }]);
    const logged = h.store.eventLog.listSince([old.key], 0).filter((entry) => entry.event.sourceId === 'c1');
    expect(logged.map((entry) => entry.seq)).toEqual([seq]);
  });
});

describe('Engine.startStorageJobs', () => {
  /** Advances the engine timers in pause-sized steps until the trim is done, at most `limit` steps. */
  function runTrim(h: Harness, limit = 100): void {
    for (let index = 0; index < limit && h.store.meta.get(BOT_BODY_TRIM_DONE_KEY) === null; index += 1) {
      h.timers.advance(50);
    }
  }

  it('runs the trim on the engine timers, sends storage_job_done, and close stops it', async () => {
    const h = makeHarness();
    h.store.prs.upsert(reportPr(1), at(1));
    h.store.prs.upsert(reportPr(2), at(1));

    h.engine.startStorageJobs();
    h.timers.advance(START_DELAY_MS);
    runTrim(h);

    expect(h.store.meta.get(BOT_BODY_TRIM_DONE_KEY)).not.toBeNull();
    expect(h.store.prs.get('acme/app#2')!.comments[0]!.body).toBe(CUT);
    expect(h.telemetry.events.filter((event) => event.event === 'storage_job_done')).toEqual([
      { event: 'storage_job_done', props: { name: 'bot_body_trim', units: 2, work_ms: expect.any(Number), longest_slice_ms: expect.any(Number), wall_ms: expect.any(Number) } },
    ]);
    await h.engine.close();
  });

  it('pauses while the Mac sleeps and goes on after the wake', async () => {
    const h = makeHarness();
    h.store.prs.upsert(reportPr(1), at(1));

    h.engine.startStorageJobs();
    h.engine.noteSuspend();
    h.timers.advance(10 * 60_000);
    expect(h.store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);

    h.engine.noteWake();
    h.timers.advance(START_DELAY_MS);
    runTrim(h);
    expect(h.store.prs.get('acme/app#1')!.comments[0]!.body).toBe(CUT);
    await h.engine.close();
  });
});

describe('Mark read put back across a rename', () => {
  // The click captures the deploy event's id; a fetch inside the undo window
  // renames it to bot_comment. Whatever puts the click back must still find it.
  const deployPr = makePr({ number: 5, comments: [makeComment({ id: 'c5', author: BOT, body: 'Preview deployed', createdAt: at(1) })], updatedAt: at(2) });
  const tileId = `pr:${deployPr.key}`;
  const thread = makeThreadFor(deployPr, { updatedAt: at(2) });

  async function clickedThenRenamed(): Promise<{ h: Harness; undoToken: string | null }> {
    const h = makeHarness();
    h.reader.addPr(deployPr, thread);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.events.listForPr(deployPr.key)).toMatchObject([{ kind: 'deploy', seenAt: null }]);
    const { undoToken } = await h.engine.markRead(tileId);
    expect(h.store.events.listForPr(deployPr.key)[0]!.seenAt).not.toBeNull();
    // The bot edits its comment so it no longer says deploy, and a fetch stores it.
    const edited = { ...deployPr, comments: [{ ...deployPr.comments[0]!, body: 'Build finished' }] };
    h.store.prs.upsert(edited, at(3));
    h.store.events.upsertDerived(edited.key, deriveEvents(edited, viewer, null));
    expect(h.store.events.listForPr(deployPr.key)).toMatchObject([{ kind: 'bot_comment' }]);
    return { h, undoToken };
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  function state(h: Harness) {
    return { threadUnread: h.store.notifications.get(thread.id)?.unread, seenAt: h.store.events.listForPr(deployPr.key)[0]!.seenAt };
  }

  it('Undo turns the renamed event unseen again', async () => {
    const { h, undoToken } = await clickedThenRenamed();
    await h.engine.undo(undoToken);
    expect(state(h)).toEqual({ threadUnread: true, seenAt: null });
  });

  it('a send GitHub did not take turns the renamed event unseen again', async () => {
    const { h } = await clickedThenRenamed();
    h.writer.failingThreads.add(thread.id);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(state(h)).toEqual({ threadUnread: true, seenAt: null });
  });

  it('parking the click when writes were locked turns the renamed event unseen again', async () => {
    const { h } = await clickedThenRenamed();
    await h.engine.setGitHubWrites(false);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.store.pendingWrites.list()).toHaveLength(1);
    expect(state(h)).toEqual({ threadUnread: true, seenAt: null });
  });
});
