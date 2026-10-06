// Storage jobs 3 and 4 (DESIGN.md "PR storage"): discussion_rows fills the
// rows of PRs stored before 0.22.0 and switches reads to them once every PR
// has them; snapshot_strip then removes the three lists from the json. No
// read changes on the way, no revision moves, and a PR that cannot be
// split never counts as one without comments.
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalPr, trimBotBodies, type Comment, type Pr } from '@postpile/core';
import { at, FakeTimers, makeComment, makePr, makeReview } from '@postpile/core/fixtures';
import { DISCUSSION_READY_KEY, runMigrations, Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, NOW } from '../testing/fakes.ts';
import { BOT_BODY_TRIM_DONE_KEY, BotBodyTrimJob } from './bot-body-trim.ts';
import { DiscussionRowsJob } from './discussion-rows.ts';
import { storageJobs } from './jobs.ts';
import { INCOMPLETE_KEY_PREFIX, PAUSE_MS, START_DELAY_MS, StorageJobRunner, type StorageJob, type StorageJobReport } from './runner.ts';
import { SnapshotStripJob } from './snapshot-strip.ts';

const BOT = 'github-actions[bot]';
const LONG_REPORT = `## Test report\n${'- a passing test with a long generated name\n'.repeat(160)}`;

/** A PR with an issue comment, a review with its body, and an inline comment in its thread. */
function discussedPr(number: number, overrides: Partial<Pr> = {}): Pr {
  const inline: Comment = makeComment({ id: `rc${number}`, kind: 'review_comment', threadId: `t${number}`, path: 'a.ts', body: 'nit', createdAt: at(12) });
  return makePr({
    number,
    body: 'cc @acme/team-platform',
    comments: [makeComment({ id: `c${number}`, createdAt: at(10) }), makeComment({ id: `rv${number}`, kind: 'review', body: 'One nit', createdAt: at(11) }), inline],
    threads: [{ id: `t${number}`, path: 'a.ts', isResolved: false, comments: [inline] }],
    reviews: [makeReview({ id: `rv${number}`, state: 'COMMENTED', body: 'One nit', submittedAt: at(11) })],
    ...overrides,
  });
}

/** The PR as 0.21.0 left it: json only, no rows, rows_version 0. */
function storedBefore031(store: Store, pr: Pr): void {
  store.prs.upsert(pr, at(1));
  for (const table of ['pr_comment', 'pr_thread', 'pr_review']) {
    store.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(pr.key);
  }
  store.db.prepare("UPDATE pr SET rows_version = 0, mentioned_teams = '[]' WHERE key = ?").run(pr.key);
}

function revisions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
}

function rowsVersions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, rows_version FROM pr ORDER BY key').all();
}

function withDiscussionInJson(store: Store): string[] {
  const rows = store.db.prepare("SELECT key FROM pr_snapshot WHERE json_type(json, '$.comments') IS NOT NULL OR json_type(json, '$.reviews') IS NOT NULL ORDER BY key").all();
  return (rows as { key: string }[]).map((row) => row.key);
}

describe('the discussion_rows and snapshot_strip jobs', () => {
  let store: Store;
  let reports: StorageJobReport[];
  let lines: string[];

  beforeEach(() => {
    store = Store.open(':memory:');
    reports = [];
    lines = [];
  });

  afterEach(() => {
    store.close();
  });

  function runner(jobs: StorageJob[] = [new DiscussionRowsJob(), new SnapshotStripJob()]): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs,
      now: () => NOW,
      timers: new FakeTimers(),
      busy: () => false,
      log: (line) => lines.push(line),
      onDone: (report) => reports.push(report),
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

  it('fills the rows of the PRs stored before, then switches reads to them, without a new revision or a different read', () => {
    storedBefore031(store, discussedPr(1));
    store.prs.upsert(discussedPr(2), at(1));
    storedBefore031(store, discussedPr(3, { comments: [], threads: [], reviews: [] }));
    const before = store.prs.listAll();
    const revisionsBefore = revisions(store);

    const jobs = runner([new DiscussionRowsJob()]);
    expect(jobs.slice()).toBe('worked');
    expect(store.meta.get(DISCUSSION_READY_KEY)).toBeNull();
    runToEnd(jobs);

    expect(rowsVersions(store)).toEqual([1, 2, 3].map((n) => ({ key: `acme/app#${n}`, rows_version: 1 })));
    expect(store.meta.get(DISCUSSION_READY_KEY)).toBe(NOW.toISOString());
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(store.prs.listAll()).toEqual(before.map(canonicalPr));
    expect(store.db.prepare("SELECT mentioned_teams FROM pr WHERE key = 'acme/app#1'").get()).toEqual({ mentioned_teams: '["acme/team-platform"]' });
    // Two PRs without rows, one already written by an upsert.
    expect(reports).toMatchObject([{ name: 'discussion_rows', units: 2, wrote: 2 }]);
  });

  it('keeps reads on the json while a PR cannot be split, and finishes once a fetch stored it again', () => {
    storedBefore031(store, discussedPr(1));
    storedBefore031(store, discussedPr(2));
    store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.threads[0].comments[0].body', 'edited') WHERE key = 'acme/app#2'").run();
    const broken = store.prs.get('acme/app#2');

    runToEnd(runner());

    expect(store.meta.get(DISCUSSION_READY_KEY)).toBeNull();
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}discussion_rows`)).not.toBeNull();
    expect(store.meta.get(new DiscussionRowsJob().doneKey)).toBeNull();
    expect(store.meta.get(new SnapshotStripJob().doneKey)).toBeNull();
    expect(rowsVersions(store)).toEqual([
      { key: 'acme/app#1', rows_version: 1 },
      { key: 'acme/app#2', rows_version: 0 },
    ]);
    expect(withDiscussionInJson(store)).toEqual(['acme/app#1', 'acme/app#2']);
    expect(store.prs.get('acme/app#2')).toEqual(broken);
    expect(lines).toEqual([expect.stringMatching(/walking it once more/), expect.stringMatching(/discussion_rows is incomplete/)]);

    // The sync fetches the PR again; the next start finishes both jobs.
    store.prs.upsert(discussedPr(2), at(5));
    runToEnd(runner());

    expect(store.meta.get(DISCUSSION_READY_KEY)).not.toBeNull();
    expect(withDiscussionInJson(store)).toEqual([]);
    expect(store.prs.get('acme/app#2')).toEqual(canonicalPr(discussedPr(2)));
  });

  it('strips the lists from every snapshot once reads take the rows, moving no revision and changing no read', () => {
    storedBefore031(store, discussedPr(1));
    store.prs.upsert(discussedPr(2), at(1));
    const before = store.prs.listAll().map(canonicalPr);
    const revisionsBefore = revisions(store);

    runToEnd(runner());

    expect(withDiscussionInJson(store)).toEqual([]);
    expect(store.prs.listAll()).toEqual(before);
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(reports.map((report) => [report.name, report.units, report.wrote])).toEqual([
      ['discussion_rows', 1, 1],
      ['snapshot_strip', 2, 2],
    ]);
  });

  it('never strips before the switch', () => {
    store.prs.upsert(discussedPr(1), at(1));
    expect(() => runner([new SnapshotStripJob()]).slice()).toThrow(/rows_ready:discussion/);
    expect(withDiscussionInJson(store)).toEqual(['acme/app#1']);
  });

  it('lets the bot body trim read and cut a PR whose json lost its discussion', () => {
    const pr = discussedPr(1, { comments: [makeComment({ id: 'c-report', author: BOT, body: LONG_REPORT })], threads: [], reviews: [] });
    store.prs.upsert(pr, at(1));
    runToEnd(runner());
    expect(withDiscussionInJson(store)).toEqual([]);

    store.meta.delete(BOT_BODY_TRIM_DONE_KEY);
    runToEnd(runner([new BotBodyTrimJob()]));

    expect(store.prs.get(pr.key)).toEqual(canonicalPr(trimBotBodies(pr)));
    expect(withDiscussionInJson(store)).toEqual([]);
  });
});

describe('the snapshot_strip checkpoint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-strip-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function walSize(path: string): number {
    return existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0;
  }

  function stripAll(store: Store): void {
    const jobs = new StorageJobRunner({ store, jobs: storageJobs(), now: () => NOW, timers: new FakeTimers(), busy: () => false, log: () => {}, onDone: () => {} });
    for (let index = 0; index < 50 && jobs.slice() !== 'idle'; index += 1) {
      // Every job, a slice at a time.
    }
  }

  it('empties the WAL at the end, and leaves it when a reader holds it', () => {
    const path = join(dir, 'db.sqlite');
    const store = Store.open(path);
    for (let number = 1; number <= 20; number += 1) {
      storedBefore031(store, discussedPr(number));
    }
    stripAll(store);
    expect(store.meta.get(new SnapshotStripJob().doneKey)).not.toBeNull();
    expect(walSize(path)).toBe(0);

    // A reader in the middle of a read: the checkpoint copies what it can and returns at once.
    const reader = new DatabaseSync(path, { readOnly: true });
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM pr').get();
    store.prs.upsert(discussedPr(21), at(2));
    expect(store.checkpointWal()).toBe(false);
    reader.exec('COMMIT');
    reader.close();
    expect(store.checkpointWal()).toBe(true);
    store.close();
  });
});

describe('an install that skips straight to this release', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-skip-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the trim, the checks strip, the backfill and the strip in one go, and reads every PR the same, cut', () => {
    const path = join(dir, 'db.sqlite');
    const old = new DatabaseSync(path);
    runMigrations(old, 27);
    const prs = [1, 2, 3].map((number) =>
      discussedPr(number, { comments: [...discussedPr(number).comments, makeComment({ id: `c-bot${number}`, author: BOT, body: LONG_REPORT, createdAt: at(13) })] }),
    );
    for (const pr of prs) {
      const json = JSON.stringify({ ...pr, checks: { rollup: 'SUCCESS', contexts: [] } });
      old
        .prepare('INSERT INTO pr (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(pr.key, pr.ref.repo, pr.ref.number, pr.state, pr.baseRef, pr.headRef, pr.updatedAt, at(1), json);
    }
    old.close();

    const store = Store.open(path);
    const reports: string[] = [];
    const jobs = new StorageJobRunner({
      store,
      jobs: storageJobs(),
      now: () => NOW,
      timers: new FakeTimers(),
      busy: () => false,
      log: () => {},
      onDone: (report) => reports.push(report.name),
      sliceBudgetMs: 0,
    });
    for (let index = 0; index < 100 && jobs.slice() !== 'idle'; index += 1) {
      // One unit per slice.
    }

    expect(reports).toEqual(['bot_body_trim', 'checks_strip', 'discussion_rows', 'snapshot_strip']);
    expect(store.prs.listAll()).toEqual(prs.map((pr) => canonicalPr(trimBotBodies(pr))));
    expect(store.db.prepare("SELECT count(*) AS n FROM pr_snapshot WHERE json_type(json, '$.checks') IS NOT NULL OR json_type(json, '$.comments') IS NOT NULL").get()).toEqual({ n: 0 });
    expect(store.db.prepare('SELECT count(*) AS n FROM pr_comment').get()).toEqual({ n: 12 });
    store.close();
  });
});

describe('Engine.startStorageJobs with the discussion rows', () => {
  it('runs every job in order on the engine timers and reports each', async () => {
    const h = makeHarness();
    storedBefore031(h.store, discussedPr(1));

    h.engine.startStorageJobs();
    h.timers.advance(START_DELAY_MS);
    for (let index = 0; index < 100 && h.store.meta.get(new SnapshotStripJob().doneKey) === null; index += 1) {
      h.timers.advance(PAUSE_MS);
    }

    expect(withDiscussionInJson(h.store)).toEqual([]);
    expect(h.store.prs.get('acme/app#1')).toEqual(canonicalPr(discussedPr(1)));
    const done = h.telemetry.events.filter((event) => event.event === 'storage_job_done').map((event) => (event.props as { name: string }).name);
    expect(done).toEqual(['bot_body_trim', 'checks_strip', 'discussion_rows', 'snapshot_strip']);
    await h.engine.close();
  });
});
