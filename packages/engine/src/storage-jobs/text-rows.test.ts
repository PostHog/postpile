// Storage job 7 (DESIGN.md "PR storage"): text_rows fills the text
// columns and body rows of PRs stored before 0.23.0 and switches reads to
// them once every PR has them; from then on no read takes the json. No read
// changes on the way: events, glance hashes and set triggers come out the
// same, so no glance goes stale on the release.
import { canonicalPr, deriveEvents, trimBotBodies, type FullPr, type Pr } from '@postpile/core';
import { at, FakeTimers, makeComment, makeCommit, makePr, makeReview, viewer } from '@postpile/core/fixtures';
import { glanceItemInputHash, setGroupingTriggers, type GlanceBatchInput, type PromptContext } from '@postpile/agent';
import { ACTIVITY_READY_KEY, DISCUSSION_READY_KEY, ROWS, Store, TEXT_READY_KEY } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../testing/fakes.ts';
import { makeTopic } from '../testing/topics.ts';
import { BOT_BODY_TRIM_DONE_KEY, BotBodyTrimJob } from './bot-body-trim.ts';
import { INCOMPLETE_KEY_PREFIX, StorageJobRunner, type StorageJob, type StorageJobBlocked, type StorageJobReport } from './runner.ts';
import { TextRowsJob } from './text-rows.ts';

const BOT = 'github-actions[bot]';
const LONG_REPORT = `## Test report\n${'- a passing test with a long generated name\n'.repeat(160)}`;
const CONTEXT: PromptContext = { instructions: 'Review carefully.', instructionsVersion: null, tailoring: '', standingRules: [], recentFeedback: [] };

/** A PR with every text field set, some discussion and commits. */
function textPr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number,
    body: `Moves the runner (#${number}). cc @acme/team-infra`,
    labels: ['infra', 'Size: M'],
    reviewDecision: 'APPROVED',
    truncated: true,
    capHits: [{ list: 'timeline', nodes: 100, oldestAt: at(1), cursor: 'Y3Vy' }],
    files: [{ path: 'src/runner.ts', additions: 40, deletions: 3 }],
    comments: [makeComment({ id: `c${number}`, body: 'Can @viewer take a look?' }), makeComment({ id: `r${number}`, kind: 'review', author: 'bob', body: 'One nit' })],
    reviews: [makeReview({ id: `r${number}`, author: 'bob', state: 'APPROVED', body: 'One nit' })],
    commits: [makeCommit({ oid: `o${number}` })],
    ...overrides,
  });
}

/** The PR as an install whose activity rows are done left it: no text rows, rows_version 2. */
function storedBefore034(store: Store, pr: FullPr): void {
  store.prs.upsert(pr, at(1));
  store.db.prepare('DELETE FROM pr_body WHERE pr_key = ?').run(pr.key);
  store.db.prepare("UPDATE pr SET rows_version = ?, url = '', labels = '[]', cap_hits = NULL, truncated = NULL WHERE key = ?").run(ROWS.activity, pr.key);
}

function revisions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
}

/** What reads feed the agent and the events: derived events, the glance input hash, the set triggers. */
function agentInputs(prs: Pr[]): unknown {
  const items = prs.map((pr) => ({ pr, provenance: { kind: 'pinged', reason: 'review_requested' } as const }));
  const glance: GlanceBatchInput = { topic: makeTopic('t1'), dossier: null, items, viewer, context: CONTEXT, attempt: 1 };
  return {
    glanceHashes: items.map((item) => glanceItemInputHash(glance, item)),
    setTriggers: setGroupingTriggers({ topic: makeTopic('t1'), prs, existingSets: [], risks: {}, context: CONTEXT }),
  };
}

describe('the text_rows job', () => {
  let store: Store;
  let reports: StorageJobReport[];
  let blocked: StorageJobBlocked[];

  beforeEach(() => {
    store = Store.open(':memory:');
    // As on an install whose discussion and activity jobs are done.
    store.meta.set(DISCUSSION_READY_KEY, at(30));
    store.meta.set(ACTIVITY_READY_KEY, at(31));
    reports = [];
    blocked = [];
  });

  afterEach(() => {
    store.close();
  });

  function runner(jobs: StorageJob[] = [new TextRowsJob()]): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs,
      now: () => NOW,
      timers: new FakeTimers(),
      busy: () => false,
      log: () => {},
      onDone: (report) => reports.push(report),
      onBlocked: (job) => blocked.push(job),
      sliceBudgetMs: 0,
    });
  }

  function runToEnd(jobs: StorageJobRunner): void {
    for (let index = 0; index < 50; index += 1) {
      const outcome = jobs.slice();
      if (outcome === 'idle' || outcome === 'incomplete') {
        return;
      }
    }
  }

  it('fills the rows, switches reads off the json, and every read, event, glance hash and set trigger stays the same', () => {
    storedBefore034(store, textPr(1));
    store.prs.upsert(textPr(2), at(1));
    const older = textPr(3);
    delete older.assignees;
    delete older.truncated;
    delete older.capHits;
    storedBefore034(store, older);
    const keys = ['acme/app#1', 'acme/app#2', 'acme/app#3'];
    const full = store.prs.listAll();
    const board = [...store.prs.getMany(keys).values()];
    const events = full.map((pr) => deriveEvents(pr, viewer, null));
    const inputs = agentInputs(board);
    const revisionsBefore = revisions(store);

    runToEnd(runner());

    expect(store.meta.get(TEXT_READY_KEY)).toBe(NOW.toISOString());
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(reports).toMatchObject([{ name: 'text_rows', units: 2, wrote: 2 }]);
    // No json from here on: emptied, every read gives the same.
    store.db.exec("UPDATE pr_snapshot SET json = '{}'");
    expect(store.prs.listAll()).toStrictEqual(full);
    expect(store.prs.listAll().map((pr) => deriveEvents(pr, viewer, null))).toEqual(events);
    const boardAfter = [...store.prs.getMany(keys).values()];
    expect(boardAfter).toStrictEqual(board);
    expect(agentInputs(boardAfter)).toEqual(inputs);
    expect(store.prs.getFull('acme/app#3')).not.toHaveProperty('assignees');
  });

  it('keeps reads on the json while a PR lacks a field, and finishes once a fetch stored it again', () => {
    storedBefore034(store, textPr(1));
    storedBefore034(store, textPr(2));
    store.db.prepare("UPDATE pr_snapshot SET json = json_remove(json, '$.url') WHERE key = 'acme/app#2'").run();

    runToEnd(runner());

    expect(store.meta.get(TEXT_READY_KEY)).toBeNull();
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}text_rows`)).not.toBeNull();
    expect(blocked).toEqual([{ name: 'text_rows', blockedUnits: 1 }]);
    expect(store.prs.getFull('acme/app#1')).toEqual(canonicalPr(textPr(1)));

    store.prs.upsert(textPr(2), at(5));
    runToEnd(runner());

    expect(store.meta.get(TEXT_READY_KEY)).not.toBeNull();
    expect(store.prs.getFull('acme/app#2')).toEqual(canonicalPr(textPr(2)));
  });

  it('lets the bot body trim read and cut a PR once reads take no json', () => {
    const pr = textPr(1, { comments: [makeComment({ id: 'c-report', author: BOT, body: LONG_REPORT })], reviews: [] });
    store.prs.upsert(pr, at(1));
    runToEnd(runner());
    store.db.exec("UPDATE pr_snapshot SET json = '{}'");

    store.meta.delete(BOT_BODY_TRIM_DONE_KEY);
    runToEnd(runner([new BotBodyTrimJob()]));

    expect(store.prs.getFull(pr.key)).toEqual(canonicalPr(trimBotBodies(pr)));
  });
});
