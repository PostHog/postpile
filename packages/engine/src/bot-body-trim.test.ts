// Bot bodies cut when saved (DESIGN.md "Bot bodies are cut when saved"):
// the one-time job cuts what is stored, in small steps, and a deploy event
// that a cut body no longer explains keeps its state wherever its PR's
// events are derived again.
import { eventId, trimBotBodies, trimBotBody, type Pr } from '@postpile/core';
import { at, FakeTimers, makeComment, makeEvent, makePr, makeReview, makeThread, makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOT_BODY_TRIM_AFTER_KEY, BOT_BODY_TRIM_DONE_KEY, BotBodyTrim } from './bot-body-trim.ts';
import { makeHarness, NOW } from './testing/fakes.ts';

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

describe('BotBodyTrim', () => {
  let store: Store;
  let timers: FakeTimers;
  let busy: boolean;
  let lines: string[];

  beforeEach(() => {
    store = Store.open(':memory:');
    timers = new FakeTimers();
    busy = false;
    lines = [];
  });

  afterEach(() => {
    store.close();
  });

  function trimJob(): BotBodyTrim {
    return new BotBodyTrim({ store, now: () => NOW, timers, busy: () => busy, log: (line) => lines.push(line), stepBudgetMs: 0 });
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
    const job = trimJob();

    job.start();
    runFor(60_000);

    const stored = store.prs.get(pr.key)!;
    expect(stored.comments.map((comment) => comment.body)).toEqual([CUT, pr.comments[1]!.body, CUT]);
    expect(stored.threads[0]!.comments[0]!.body).toBe(CUT);
    expect(stored.reviews[0]!.body).toBe(CUT);
    expect(stored.body).toBe(LATE_DEPLOY);
    expect(store.prs.fetchedAt(pr.key)).toBe(at(1));
    expect(job.isDone()).toBe(true);
    expect(store.meta.get(BOT_BODY_TRIM_DONE_KEY)).toBe(NOW.toISOString());
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBeNull();
    expect(lines).toEqual([expect.stringMatching(/^bot body trim: cut 1 of 1 stored PRs in \d+ ms$/)]);
  });

  it('waits after start, and while foreground work runs', () => {
    store.prs.upsert(reportPr(1), at(1));
    const job = trimJob();
    job.start();
    timers.advance(29_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);

    busy = true;
    timers.advance(10_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(LATE_DEPLOY);

    busy = false;
    runFor(10_000);
    expect(store.prs.get('acme/app#1')!.comments[0]!.body).toBe(CUT);
  });

  it('goes a PR per step within its budget, moving the cursor only past PRs done', () => {
    for (const number of [1, 2, 3]) {
      store.prs.upsert(reportPr(number), at(1));
    }
    const job = trimJob();
    expect(job.step()).toBe(true);
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#1');
    expect(store.prs.get('acme/app#2')!.comments[0]!.body).toBe(LATE_DEPLOY);
    expect(job.step()).toBe(true);
    expect(job.step()).toBe(true);
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#3');
    expect(job.step()).toBe(false);
    expect(job.isDone()).toBe(true);
  });

  it('resumes after the last step when stopped, and runs once', () => {
    for (const number of [1, 2, 3]) {
      store.prs.upsert(reportPr(number), at(1));
    }
    const first = trimJob();
    first.start();
    timers.advance(30_000);
    first.stop();
    timers.advance(60_000);
    expect(store.meta.get(BOT_BODY_TRIM_AFTER_KEY)).toBe('acme/app#1');
    expect(store.prs.get('acme/app#3')!.comments[0]!.body).toBe(LATE_DEPLOY);

    const second = trimJob();
    second.start();
    runFor(60_000);
    expect(store.prs.listAll().every((pr) => pr.comments[0]!.body === CUT)).toBe(true);
    expect(lines.at(-1)).toMatch(/cut 2 of 2 stored PRs/);

    store.prs.upsert(reportPr(4), at(5));
    trimJob().start();
    timers.advance(120_000);
    expect(store.prs.get('acme/app#4')!.comments[0]!.body).toBe(LATE_DEPLOY);
  });

  it('leaves events as they are: the next derive moves them (EventRepo)', () => {
    const pr = reportPr(1);
    store.prs.upsert(pr, at(1));
    const old = storeOldDeployEvent(store, pr);
    const before = store.events.listForPr(pr.key);

    trimJob().start();
    runFor(60_000);

    expect(store.events.listForPr(pr.key)).toEqual(before);
    expect(before.map((event) => event.id)).toEqual([old]);
  });

  it('keeps a bot comment a person edited last whole', () => {
    const edited = makeComment({ id: 'c1', author: BOT, editor: 'alice', body: `${LATE_DEPLOY}\ncc @viewer`, lastEditedAt: at(40) });
    const pr = makePr({ comments: [edited] });
    store.prs.upsert(pr, at(1));

    trimJob().start();
    runFor(60_000);

    expect(store.prs.get(pr.key)).toEqual(pr);
    expect(lines.at(-1)).toMatch(/cut 0 of 1 stored PRs/);
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

describe('Engine.startBotBodyTrim', () => {
  it('runs the job on the engine timers, and close stops it', async () => {
    const h = makeHarness();
    h.store.prs.upsert(reportPr(1), at(1));
    h.store.prs.upsert(reportPr(2), at(1));

    h.engine.startBotBodyTrim();
    h.timers.advance(30_000);
    for (let index = 0; index < 100 && h.store.meta.get(BOT_BODY_TRIM_DONE_KEY) === null; index += 1) {
      h.timers.advance(20);
    }

    expect(h.store.meta.get(BOT_BODY_TRIM_DONE_KEY)).not.toBeNull();
    expect(h.store.prs.get('acme/app#2')!.comments[0]!.body).toBe(CUT);
    await h.engine.close();
  });
});
