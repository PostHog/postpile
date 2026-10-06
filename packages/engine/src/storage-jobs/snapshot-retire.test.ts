// Storage job 8 and migration 035 (DESIGN.md "PR storage"): once no read
// takes the json, snapshot_retire empties `pr_snapshot` a row at a time and
// drops it, and nothing else ever names the table again. An install that
// skipped releases runs every job in one go and reads the same board
// before and after.
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boardShape, canonicalPr, trimBotBodies, type FullPr } from '@postpile/core';
import { at, FakeTimers, makeComment, makeCommit, makePr, makeReview, makeTimelineItem } from '@postpile/core/fixtures';
import { ACTIVITY_READY_KEY, currentVersion, DISCUSSION_READY_KEY, LATEST_VERSION, runMigrations, Store, TEXT_READY_KEY } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../testing/fakes.ts';
import { storageJobs } from './jobs.ts';
import { StorageJobRunner, type StorageJob, type StorageJobReport } from './runner.ts';
import { SnapshotRetireJob } from './snapshot-retire.ts';

const BOT = 'github-actions[bot]';
const LONG_REPORT = `## Test report\n${'- a passing test with a long generated name\n'.repeat(160)}`;

/** A PR with something in every collection: discussion (a long bot comment among it), commits, timeline, files, text. */
function fullPr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  const inline = makeComment({ id: `rc${number}`, kind: 'review_comment', threadId: `t${number}`, path: 'a.ts', body: 'nit', createdAt: at(12) });
  return makePr({
    number,
    body: `Moves the runner. cc @acme/team-platform (#${number})`,
    labels: ['infra'],
    truncated: false,
    capHits: [],
    comments: [
      makeComment({ id: `c${number}`, createdAt: at(10) }),
      makeComment({ id: `bot${number}`, author: BOT, body: LONG_REPORT, createdAt: at(11) }),
      makeComment({ id: `rv${number}`, kind: 'review', body: 'One nit', createdAt: at(12) }),
      inline,
    ],
    threads: [{ id: `t${number}`, path: 'a.ts', isResolved: false, comments: [inline] }],
    reviews: [makeReview({ id: `rv${number}`, state: 'COMMENTED', body: 'One nit', submittedAt: at(12) })],
    commits: [makeCommit({ oid: `o${number}` })],
    timeline: [makeTimelineItem({ id: `i${number}` })],
    files: [{ path: 'a.ts', additions: 3, deletions: 1 }],
    ...overrides,
  });
}

function runner(store: Store, jobs: StorageJob[], reports: StorageJobReport[] = []): StorageJobRunner {
  return new StorageJobRunner({ store, jobs, now: () => NOW, timers: new FakeTimers(), busy: () => false, log: () => {}, onDone: (report) => reports.push(report), sliceBudgetMs: 0 });
}

function runToEnd(jobs: StorageJobRunner): void {
  for (let index = 0; index < 200; index += 1) {
    const outcome = jobs.slice();
    if (outcome === 'idle' || outcome === 'incomplete') {
      return;
    }
  }
}

function revisions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
}

function walSize(path: string): number {
  return existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0;
}

describe('the snapshot_retire job', () => {
  let dir: string;
  let path: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-retire-'));
    path = join(dir, 'db.sqlite');
    store = Store.open(path);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function switchToRows(): void {
    store.meta.set(DISCUSSION_READY_KEY, at(40));
    store.meta.set(ACTIVITY_READY_KEY, at(41));
    store.meta.set(TEXT_READY_KEY, at(42));
  }

  it('empties and drops pr_snapshot without a new revision or a different read, and empties the WAL', () => {
    for (let number = 1; number <= 5; number += 1) {
      store.prs.upsert(fullPr(number), at(1));
    }
    switchToRows();
    const keys = store.prs.keys();
    const before = store.prs.listAll();
    const cached = store.prs.keepParsed(keys);
    const revisionsBefore = revisions(store);
    const reports: StorageJobReport[] = [];

    runToEnd(runner(store, [new SnapshotRetireJob()], reports));

    expect(store.prs.hasSnapshotTable()).toBe(false);
    expect(reports.map((report) => [report.name, report.units])).toEqual([['snapshot_retire', 5]]);
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(store.prs.listAll()).toStrictEqual(before);
    const board = store.prs.keepParsed(keys);
    for (const key of keys) {
      expect(board.get(key)).toBe(cached.get(key));
    }
    expect(walSize(path)).toBe(0);
  });

  it('keeps every write and read working once the table is gone', () => {
    store.prs.upsert(fullPr(1), at(1));
    switchToRows();
    runToEnd(runner(store, [new SnapshotRetireJob()]));

    const edited = fullPr(1, { title: 'Retitled', labels: ['infra', 'bug'] });
    store.prs.upsert(edited, at(2));
    store.prs.upsert(fullPr(2), at(2));
    expect(store.prs.getFull('acme/app#1')).toEqual(canonicalPr(edited));
    expect(store.prs.get('acme/app#2')).toEqual(boardShape(canonicalPr(fullPr(2))));
    expect([...store.prs.fetchedAtByKey().entries()]).toEqual([
      ['acme/app#1', at(2)],
      ['acme/app#2', at(2)],
    ]);
    expect(store.prs.updatedAtByKey().size).toBe(2);
    expect(store.prs.fetchedAt('acme/app#1')).toBe(at(2));
    expect(store.prs.nextAfter('acme/app#1')?.key).toBe('acme/app#2');
    store.prs.delete('acme/app#2');
    expect(store.prs.keys()).toEqual(['acme/app#1']);
    expect(store.prs.hasSnapshotTable()).toBe(false);
  });

  it('never retires while reads take the json', () => {
    store.prs.upsert(fullPr(1), at(1));
    store.meta.set(DISCUSSION_READY_KEY, at(40));
    store.meta.set(ACTIVITY_READY_KEY, at(41));
    expect(() => runner(store, [new SnapshotRetireJob()]).slice()).toThrow(/rows_ready:text/);
    expect(store.prs.hasSnapshotTable()).toBe(true);
    expect(store.prs.getFull('acme/app#1')).toEqual(canonicalPr(fullPr(1)));
  });

  it('leaves the table while it holds a row, and walks once more', () => {
    store.prs.upsert(fullPr(1), at(1));
    switchToRows();
    // A row the walk already passed: written behind the cursor, as no build that knows 035 does.
    const jobs = runner(store, [new SnapshotRetireJob()]);
    expect(jobs.slice()).toBe('worked');
    store.db.exec("INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json) VALUES ('acme/app#0', 'acme/app', 0, 'OPEN', 'm', 'h', '', '', '{}')");
    expect(jobs.slice()).toBe('worked');
    expect(store.prs.hasSnapshotTable()).toBe(true);
    runToEnd(jobs);
    expect(store.prs.hasSnapshotTable()).toBe(false);
  });

  it('lets a reader opened before the drop read on after it', () => {
    store.prs.upsert(fullPr(1), at(1));
    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.getFull('acme/app#1')).toEqual(fullPr(1));
      switchToRows();
      runToEnd(runner(store, [new SnapshotRetireJob()]));
      expect(reader.prs.getFull('acme/app#1')).toEqual(canonicalPr(fullPr(1)));
      expect([...reader.prs.fetchedAtByKey().keys()]).toEqual(['acme/app#1']);
    } finally {
      reader.close();
    }
  });
});

describe('an install that skips releases straight to 035', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'postpile-skip-035-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A database at `version` holding `prs` the way builds of that schema wrote them. */
  function seedOld(path: string, version: 27 | 30, prs: FullPr[]): void {
    const old = new DatabaseSync(path);
    runMigrations(old, version);
    for (const pr of prs) {
      if (version === 27) {
        // Before 028 the pr row held the json, checks included (0.20.0 and before fetched CI).
        old
          .prepare('INSERT INTO pr (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(pr.key, pr.ref.repo, pr.ref.number, pr.state, pr.baseRef, pr.headRef, pr.updatedAt, at(1), JSON.stringify({ ...pr, checks: { rollup: 'SUCCESS', contexts: [] } }));
        continue;
      }
      old
        .prepare(
          `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams, base_ref, head_ref, head_oid,
             previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision)
           VALUES (?, ?, ?, ?, 0, ?, ?, '[]', '[]', '[]', ?, ?, ?, '[]', 0, ?, ?, NULL, ?, 1)`,
        )
        .run(pr.key, pr.ref.repo, pr.ref.number, pr.state, pr.title, pr.author, pr.baseRef, pr.headRef, pr.headOid, pr.createdAt, pr.updatedAt, at(1));
      old
        .prepare('INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(pr.key, pr.ref.repo, pr.ref.number, pr.state, pr.baseRef, pr.headRef, pr.updatedAt, at(1), JSON.stringify(pr));
    }
    old.close();
  }

  for (const version of [27, 30] as const) {
    it(`from schema ${version}: the barrier first, then every job in one go, the board the same before and after`, () => {
      const path = join(dir, 'db.sqlite');
      const prs = [1, 2, 3].map((number) => fullPr(number));
      // An older snapshot: no assignees, cap hits or truncated flag yet.
      delete prs[2]!.assignees;
      delete prs[2]!.capHits;
      delete prs[2]!.truncated;
      seedOld(path, version, prs);

      const store = Store.open(path);
      // 035 is recorded at open, before any job ran: from here on builds before it refuse the file.
      expect(currentVersion(store.db)).toBe(LATEST_VERSION);
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(35);
      const keys = prs.map((pr) => pr.key);
      // The board's first read on the new build, before any job: from the json, already in board shape.
      expect([...store.prs.keepParsed(keys).values()]).toEqual(prs.map(boardShape));
      const reports: StorageJobReport[] = [];
      runToEnd(runner(store, storageJobs(), reports));

      expect(reports.map((report) => report.name)).toEqual(storageJobs().map((job) => job.name));
      expect(store.prs.hasSnapshotTable()).toBe(false);
      const cut = prs.map((pr) => canonicalPr(trimBotBodies(pr)));
      expect(store.prs.listAll()).toEqual(cut);
      expect(store.prs.getFull('acme/app#3')).not.toHaveProperty('assignees');
      expect(store.prs.getFull('acme/app#3')).not.toHaveProperty('capHits');
      const board = [...store.prs.keepParsed(keys).values()];
      expect(board).toEqual(cut.map(boardShape));
      expect(board.map((pr) => pr.comments.find((comment) => comment.author === BOT)?.body)).toEqual([null, null, null]);
      expect(store.db.prepare('SELECT DISTINCT rows_version FROM pr').all()).toEqual([{ rows_version: 3 }]);
      store.close();
    });
  }
});
