// The activity lists as rows (migration 033, DESIGN.md "PR storage"): every
// upsert writes the commits, timeline and files as rows, a backfill fills
// them from the json of PRs stored before, reads switch to them once
// `rows_ready:activity` is set, and the json then loses the three lists
// without any read changing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ActivityError, boardShape, canonicalPr, type Commit, type FullPr } from '@postpile/core';
import { at, makeCommit, makeComment, makePr, makeTimelineItem } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_READY_KEY, DISCUSSION_READY_KEY, ROWS, runMigrations, Store } from './index.ts';

let dir: string;
let path: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-activity-'));
  path = join(dir, 'db.sqlite');
  store = Store.open(path);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A commit as snapshots stored before the committer was fetched hold it. */
function commitWithoutCommitter(oid: string, committedAt: string): Commit {
  const { committer: _committer, ...commit } = makeCommit({ oid, committedAt });
  return commit;
}

/** A PR with commits (an older page paged in first, one without a committer), timeline items and files. */
function activePr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number,
    comments: [makeComment({ id: `c${number}` })],
    commits: [commitWithoutCommitter(`old${number}`, at(2)), makeCommit({ oid: `new${number}`, committedAt: at(1), committer: 'web-flow' })],
    timeline: [makeTimelineItem({ id: `i${number}`, subject: null }), makeTimelineItem({ id: `j${number}`, kind: 'merged', at: at(9) })],
    files: [
      { path: 'src/z.ts', additions: 3, deletions: 1 },
      { path: 'src/a.ts', additions: 1, deletions: 0 },
    ],
    ...overrides,
  });
}

/** The PR as 0.22.0 left it: discussion rows, no activity rows, rows_version 1. */
function storedBefore033(pr: FullPr, fetchedAt = at(1)): void {
  store.prs.upsert(pr, fetchedAt);
  for (const table of ['pr_commit', 'pr_timeline', 'pr_file']) {
    store.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(pr.key);
  }
  store.db.prepare('UPDATE pr SET rows_version = ? WHERE key = ?').run(ROWS.discussion, pr.key);
}

function count(table: string, key?: string): number {
  const where = key === undefined ? '' : ' WHERE pr_key = ?';
  return (store.db.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get(...(key === undefined ? [] : [key])) as { n: number }).n;
}

function header(key: string): { rows_version: number; snapshot_revision: number } {
  return store.db.prepare('SELECT rows_version, snapshot_revision FROM pr WHERE key = ?').get(key) as never;
}

function jsonHas(key: string, field: string): boolean {
  return (store.db.prepare(`SELECT json_type(json, '$.${field}') AS type FROM pr_snapshot WHERE key = ?`).get(key) as { type: string | null }).type !== null;
}

/** Both switches, as on an install whose discussion_rows and activity_rows are done. */
function switchToRows(): void {
  store.meta.set(DISCUSSION_READY_KEY, at(40));
  store.meta.set(ACTIVITY_READY_KEY, at(41));
}

describe('migration 033', () => {
  it('adds the tables to a 032 database and leaves its PRs on the json', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 32);
    const pr = activePr(1);
    db.prepare(
      `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams, base_ref, head_ref, head_oid,
         previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision, rows_version)
       VALUES (?, 'acme/app', 1, 'OPEN', 0, ?, 'alice', '[]', '[]', '[]', 'master', 'branch-1', 'head', '[]', 0, ?, ?, NULL, ?, 3, 1)`,
    ).run(pr.key, pr.title, pr.createdAt, pr.updatedAt, at(1));
    db.prepare(
      `INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
       VALUES (?, 'acme/app', 1, 'OPEN', 'master', 'branch-1', ?, ?, ?)`,
    ).run(pr.key, pr.updatedAt, at(1), JSON.stringify({ ...pr, comments: [], threads: [], reviews: [] }));

    runMigrations(db);

    const migrated = new Store(db);
    migrated.meta.set(DISCUSSION_READY_KEY, at(40));
    expect(db.prepare('SELECT count(*) AS n FROM pr_commit').get()).toEqual({ n: 0 });
    expect(migrated.prs.getFull(pr.key)).toEqual(canonicalPr({ ...pr, comments: [], threads: [], reviews: [] }));
    expect(migrated.prs.nextWithoutRows('activity', '')).toBe(pr.key);
    expect(migrated.prs.countWithoutRows('activity')).not.toBe(0);
    db.close();
  });

  it('refuses a file path twice in one PR, and negative positions', () => {
    store.prs.upsert(makePr({ number: 1 }), at(1));
    const insertFile = (path: string, ord: number) => store.db.prepare("INSERT INTO pr_file (pr_key, path, ord, additions, deletions) VALUES ('acme/app#1', ?, ?, 0, 0)").run(path, ord);
    insertFile('a.ts', 0);
    expect(() => insertFile('a.ts', 1)).toThrow(/UNIQUE/);
    expect(() => insertFile('b.ts', -1)).toThrow(/CHECK/);
    expect(() => insertFile('A.ts', 1)).not.toThrow();
  });
});

describe('PrRepo writes the activity rows on every upsert', () => {
  it('one row per commit, timeline item and file, in stored order, the json still whole', () => {
    const pr = activePr(1);
    store.prs.upsert(pr, at(1));

    expect([count('pr_commit'), count('pr_timeline'), count('pr_file')]).toEqual([2, 2, 2]);
    expect(store.db.prepare('SELECT oid, ord, committer FROM pr_commit ORDER BY ord').all()).toEqual([
      { oid: 'old1', ord: 0, committer: null },
      { oid: 'new1', ord: 1, committer: 'web-flow' },
    ]);
    expect(store.db.prepare('SELECT path, ord FROM pr_file ORDER BY ord').all()).toEqual([
      { path: 'src/z.ts', ord: 0 },
      { path: 'src/a.ts', ord: 1 },
    ]);
    expect(jsonHas(pr.key, 'commits')).toBe(true);
    expect(store.prs.getFull(pr.key)).toEqual(pr);
  });

  it('drops the rows a refetch no longer brings', () => {
    const pr = activePr(1);
    store.prs.upsert(pr, at(1));
    store.prs.upsert({ ...pr, commits: pr.commits.slice(1), files: [] }, at(2));

    expect(store.db.prepare('SELECT oid FROM pr_commit').all()).toEqual([{ oid: 'new1' }]);
    expect(count('pr_file')).toBe(0);
    switchToRows();
    expect(store.prs.getFull(pr.key)!.commits.map((commit) => commit.oid)).toEqual(['new1']);
  });

  it('refuses a file path twice, and writes nothing', () => {
    const pr = activePr(1);
    store.prs.upsert(pr, at(1));
    const revision = header(pr.key).snapshot_revision;

    const twice = { ...pr, files: [...pr.files, { path: 'src/a.ts', additions: 9, deletions: 9 }] };
    expect(() => store.prs.upsert(twice, at(2))).toThrow(ActivityError);
    expect(header(pr.key).snapshot_revision).toBe(revision);
    expect(store.prs.getFull(pr.key)).toEqual(pr);
  });

  it('deletes the rows with the PR, and cascades when only the header goes', () => {
    store.prs.upsert(activePr(1), at(1));
    store.prs.upsert(activePr(2), at(1));
    store.prs.delete('acme/app#1');
    expect(count('pr_commit', 'acme/app#1')).toBe(0);

    store.db.exec("DELETE FROM pr WHERE key = 'acme/app#2'");
    expect([count('pr_commit'), count('pr_timeline'), count('pr_file')]).toEqual([0, 0, 0]);
  });
});

describe('PrRepo.backfillActivity', () => {
  it('writes the rows from the json without a new revision, and the PR reads the same from them', () => {
    const pr = activePr(1);
    storedBefore033(pr);
    const revision = header(pr.key).snapshot_revision;

    expect(store.prs.backfillActivity(pr.key)).toBe(true);

    expect(header(pr.key)).toEqual({ rows_version: ROWS.activity, snapshot_revision: revision });
    expect(store.prs.countWithoutRows('activity')).toBe(0);
    switchToRows();
    store.prs.stripJson('activity', pr.key);
    expect(store.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
  });

  it('never takes a missing or broken snapshot for one without commits', () => {
    const missing = activePr(1);
    storedBefore033(missing);
    store.db.exec("DELETE FROM pr_snapshot WHERE key = 'acme/app#1'");
    const twice = activePr(2);
    storedBefore033(twice);
    store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.files[1].path', 'src/z.ts') WHERE key = ?").run(twice.key);
    const noList = activePr(3);
    storedBefore033(noList);
    store.db.prepare("UPDATE pr_snapshot SET json = json_remove(json, '$.timeline') WHERE key = ?").run(noList.key);
    const malformed = activePr(4);
    storedBefore033(malformed);
    store.db.prepare("UPDATE pr_snapshot SET json = '{not json' WHERE key = ?").run(malformed.key);
    const noHeadline = activePr(5);
    storedBefore033(noHeadline);
    store.db.prepare("UPDATE pr_snapshot SET json = json_remove(json, '$.commits[1].headline') WHERE key = ?").run(noHeadline.key);

    for (const key of ['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#4', 'acme/app#5']) {
      expect(store.prs.backfillActivity(key), key).toBe(false);
      expect(header(key).rows_version, key).toBe(ROWS.discussion);
    }
    expect([count('pr_commit'), count('pr_timeline'), count('pr_file')]).toEqual([0, 0, 0]);
    expect(store.prs.countWithoutRows('activity')).not.toBe(0);
  });

  it('raises only a PR at the discussion version: rows_version is cumulative', () => {
    const pr = activePr(1);
    storedBefore033(pr);
    store.db.prepare('UPDATE pr SET rows_version = 0 WHERE key = ?').run(pr.key);

    expect(store.prs.backfillActivity(pr.key)).toBe(false);
    expect(header(pr.key).rows_version).toBe(0);
    expect(count('pr_commit')).toBe(0);
  });

  it('walks only the PRs without rows', () => {
    storedBefore033(activePr(1));
    store.prs.upsert(activePr(2), at(1));
    storedBefore033(activePr(3));
    expect(store.prs.nextWithoutRows('activity', '')).toBe('acme/app#1');
    expect(store.prs.nextWithoutRows('activity', 'acme/app#1')).toBe('acme/app#3');
    expect(store.prs.nextWithoutRows('activity', 'acme/app#3')).toBeNull();
  });
});

describe('PrRepo after the switch to activity rows', () => {
  it('writes the json without the lists, reads the same PR, and the strip moves no revision', () => {
    const before = activePr(1);
    store.prs.upsert(before, at(1));
    switchToRows();
    expect(store.prs.getFull(before.key)).toEqual(canonicalPr(before));

    const revision = header(before.key).snapshot_revision;
    store.prs.stripJson('discussion', before.key);
    expect(store.prs.stripJson('activity', before.key)).toBe(true);
    expect(store.prs.stripJson('activity', before.key)).toBe(false);
    expect(header(before.key).snapshot_revision).toBe(revision);
    expect(['commits', 'timeline', 'files', 'labels'].map((field) => jsonHas(before.key, field))).toEqual([false, false, false, true]);
    expect(store.prs.getFull(before.key)).toEqual(canonicalPr(before));

    const after = activePr(2);
    store.prs.upsert(after, at(2));
    expect(['commits', 'comments', 'body'].map((field) => jsonHas(after.key, field))).toEqual([false, false, true]);
    expect(store.prs.getMany([after.key]).get(after.key)).toEqual(boardShape(canonicalPr(after)));
    expect(store.prs.listAll()).toEqual([canonicalPr(before), canonicalPr(after)]);
    expect(store.prs.nextAfter('acme/app#1')?.pr).toEqual(canonicalPr(after));
  });

  it('refuses to strip before the switch', () => {
    store.prs.upsert(activePr(1), at(1));
    store.meta.set(DISCUSSION_READY_KEY, at(40));
    expect(() => store.prs.stripJson('activity', 'acme/app#1')).toThrow(/rows_ready:activity/);
    expect(jsonHas('acme/app#1', 'commits')).toBe(true);
  });

  it('keeps cached copies across the switch: the revision did not move and the rows hold the same', () => {
    const pr = activePr(1);
    store.prs.upsert(pr, at(1));
    store.meta.set(DISCUSSION_READY_KEY, at(40));
    const cached = store.prs.keepParsed([pr.key]).get(pr.key);

    store.meta.set(ACTIVITY_READY_KEY, at(41));
    store.prs.stripJson('activity', pr.key);

    expect(store.prs.keepParsed([pr.key]).get(pr.key)).toBe(cached);
    expect(store.prs.getMany([pr.key]).get(pr.key)).toEqual(cached);
  });

  it('leaves out a PR below the activity version, so the sync fetches it again', () => {
    store.prs.upsert(activePr(1), at(1));
    storedBefore033(activePr(2));
    switchToRows();

    expect(store.prs.getFull('acme/app#2')).toBeNull();
    expect([...store.prs.keepParsed(['acme/app#1', 'acme/app#2']).keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.fetchedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.updatedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect(store.prs.fetchedAt('acme/app#2')).toBeNull();
    expect(store.prs.nextAfter('acme/app#1')).toBeNull();
  });

  it('a read-only connection opened after the switch reads the rows', () => {
    const pr = activePr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.prs.stripJson('activity', pr.key);

    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
      expect(reader.db.isTransaction).toBe(false);
    } finally {
      reader.close();
    }
  });

  it('refuses rows that do not hold together', () => {
    store.prs.upsert(activePr(1), at(1));
    switchToRows();
    store.db.exec("UPDATE pr_file SET ord = 0 WHERE path = 'src/a.ts'");
    expect(() => store.prs.getFull('acme/app#1')).toThrow(/two entries at position 0 of the files/);
  });
});
