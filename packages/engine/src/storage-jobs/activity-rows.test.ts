// Storage jobs 5 and 6 (DESIGN.md "PR storage"): activity_rows fills the
// commit, timeline and file rows of PRs stored before 0.23.0 and switches
// reads to them once every PR has them; snapshot_strip_2 then removes the
// three lists from the json. No read changes on the way, no revision
// moves, and a PR that cannot be split never counts as one without commits.
import { canonicalPr, trimBotBodies, type Commit, type FullPr } from '@postpile/core';
import { at, FakeTimers, makeComment, makeCommit, makePr, makeTimelineItem } from '@postpile/core/fixtures';
import { ACTIVITY_READY_KEY, DISCUSSION_READY_KEY, NEWEST_ROWS_VERSION, ROWS, Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../testing/fakes.ts';
import { ActivityRowsJob } from './activity-rows.ts';
import { BOT_BODY_TRIM_DONE_KEY, BotBodyTrimJob } from './bot-body-trim.ts';
import { INCOMPLETE_KEY_PREFIX, StorageJobRunner, type StorageJob, type StorageJobBlocked, type StorageJobReport } from './runner.ts';
import { SnapshotStrip2Job } from './snapshot-strip-2.ts';

const BOT = 'github-actions[bot]';
const LONG_REPORT = `## Test report\n${'- a passing test with a long generated name\n'.repeat(160)}`;

function commitWithoutCommitter(oid: string): Commit {
  const { committer: _committer, ...commit } = makeCommit({ oid });
  return commit;
}

/** A PR with commits (one without a committer), a timeline item and files. */
function activePr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number,
    commits: [commitWithoutCommitter(`a${number}`), makeCommit({ oid: `b${number}`, committer: 'web-flow' })],
    timeline: [makeTimelineItem({ id: `i${number}` })],
    files: [
      { path: 'b.ts', additions: 1, deletions: 0 },
      { path: 'a.ts', additions: 2, deletions: 1 },
    ],
    ...overrides,
  });
}

/** The PR as 0.22.0 left it: discussion rows, no activity rows, rows_version 1. */
function storedBefore033(store: Store, pr: FullPr): void {
  store.prs.upsert(pr, at(1));
  for (const table of ['pr_commit', 'pr_timeline', 'pr_file']) {
    store.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(pr.key);
  }
  store.db.prepare('UPDATE pr SET rows_version = ? WHERE key = ?').run(ROWS.discussion, pr.key);
}

function revisions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
}

function rowsVersions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, rows_version FROM pr ORDER BY key').all();
}

function withActivityInJson(store: Store): string[] {
  const rows = store.db.prepare("SELECT key FROM pr_snapshot WHERE json_type(json, '$.commits') IS NOT NULL OR json_type(json, '$.files') IS NOT NULL ORDER BY key").all();
  return (rows as { key: string }[]).map((row) => row.key);
}

describe('the activity_rows and snapshot_strip_2 jobs', () => {
  let store: Store;
  let reports: StorageJobReport[];
  let blocked: StorageJobBlocked[];
  let lines: string[];

  beforeEach(() => {
    store = Store.open(':memory:');
    // As on an install whose discussion jobs are done.
    store.meta.set(DISCUSSION_READY_KEY, at(30));
    reports = [];
    blocked = [];
    lines = [];
  });

  afterEach(() => {
    store.close();
  });

  function runner(jobs: StorageJob[] = [new ActivityRowsJob(), new SnapshotStrip2Job()]): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs,
      now: () => NOW,
      timers: new FakeTimers(),
      busy: () => false,
      log: (line) => lines.push(line),
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

  it('fills the rows of the PRs stored before, then switches reads to them, without a new revision or a different read', () => {
    storedBefore033(store, activePr(1));
    store.prs.upsert(activePr(2), at(1));
    storedBefore033(store, activePr(3, { commits: [], timeline: [], files: [] }));
    const before = store.prs.listAll();
    const revisionsBefore = revisions(store);

    const jobs = runner([new ActivityRowsJob()]);
    expect(jobs.slice()).toBe('worked');
    expect(store.meta.get(ACTIVITY_READY_KEY)).toBeNull();
    runToEnd(jobs);

    expect(rowsVersions(store)).toEqual([1, 2, 3].map((n) => ({ key: `acme/app#${n}`, rows_version: n === 2 ? NEWEST_ROWS_VERSION : ROWS.activity })));
    expect(store.meta.get(ACTIVITY_READY_KEY)).toBe(NOW.toISOString());
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(store.prs.listAll()).toEqual(before);
    expect(reports).toMatchObject([{ name: 'activity_rows', units: 2, wrote: 2 }]);
  });

  it('switches without a PR that cannot be split, which then counts as not stored until a fetch stores it again', () => {
    storedBefore033(store, activePr(1));
    storedBefore033(store, activePr(2));
    store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.files[1].path', 'b.ts') WHERE key = 'acme/app#2'").run();

    runToEnd(runner());

    expect(store.meta.get(ACTIVITY_READY_KEY)).not.toBeNull();
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}activity_rows`)).toBeNull();
    expect(store.meta.get(new SnapshotStrip2Job().doneKey)).not.toBeNull();
    expect(rowsVersions(store)).toEqual([
      { key: 'acme/app#1', rows_version: ROWS.activity },
      { key: 'acme/app#2', rows_version: ROWS.discussion },
    ]);
    expect(store.prs.getFull('acme/app#2')).toBeNull();
    expect([...store.prs.fetchedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect(blocked).toEqual([{ name: 'activity_rows', blockedUnits: 1 }]);

    store.prs.upsert(activePr(2), at(5));
    expect(store.prs.getFull('acme/app#2')).toEqual(canonicalPr(activePr(2)));
  });

  it('strips the lists from every snapshot once reads take the rows, moving no revision and changing no read', () => {
    storedBefore033(store, activePr(1));
    store.prs.upsert(activePr(2), at(1));
    const before = store.prs.listAll();
    const revisionsBefore = revisions(store);

    runToEnd(runner());

    expect(withActivityInJson(store)).toEqual([]);
    expect(store.prs.listAll()).toEqual(before);
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(reports.map((report) => [report.name, report.units, report.wrote])).toEqual([
      ['activity_rows', 1, 1],
      ['snapshot_strip_2', 2, 2],
    ]);
  });

  it('never strips before the switch', () => {
    store.prs.upsert(activePr(1), at(1));
    expect(() => runner([new SnapshotStrip2Job()]).slice()).toThrow(/rows_ready:activity/);
    expect(withActivityInJson(store)).toEqual(['acme/app#1']);
  });

  it('lets the bot body trim read and cut a PR whose json lost its activity lists', () => {
    const pr = activePr(1, { comments: [makeComment({ id: 'c-report', author: BOT, body: LONG_REPORT })] });
    store.prs.upsert(pr, at(1));
    runToEnd(runner());
    expect(withActivityInJson(store)).toEqual([]);

    store.meta.delete(BOT_BODY_TRIM_DONE_KEY);
    runToEnd(runner([new BotBodyTrimJob()]));

    expect(store.prs.getFull(pr.key)).toEqual(canonicalPr(trimBotBodies(pr)));
    expect(withActivityInJson(store)).toEqual([]);
  });
});
