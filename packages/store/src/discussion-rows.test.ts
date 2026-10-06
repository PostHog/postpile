// The discussion as rows (migration 031, DESIGN.md "PR storage"): every
// upsert writes them, a backfill fills them from the json of PRs stored
// before, reads switch to them once `rows_ready:discussion` is set, and the
// json then loses the three lists without any read changing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boardShape, canonicalPr, DiscussionError, type FullComment, type FullPr } from '@postpile/core';
import { at, makeComment, makePr, makeReview } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISCUSSION_READY_KEY, NEWEST_ROWS_VERSION, runMigrations, Store } from './index.ts';

let dir: string;
let path: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-discussion-'));
  path = join(dir, 'db.sqlite');
  store = Store.open(path);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A PR with an issue comment, a review body, an inline comment in its thread, and reviews with and without a body. */
function discussedPr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  const inline: FullComment = makeComment({
    id: `rc${number}`,
    kind: 'review_comment',
    threadId: `t${number}`,
    path: 'src/a.ts',
    reviewId: `rv${number}`,
    body: 'nit: rename this',
    createdAt: at(12),
    viewerReacted: false,
  });
  return makePr({
    number,
    body: 'Fixes the runner. cc @acme/team-infra',
    comments: [
      makeComment({ id: `c${number}`, body: 'Can @Acme/Team-Platform take a look?', createdAt: at(10), lastEditedAt: at(11), editor: 'bob', updatedAt: at(11) }),
      makeComment({ id: `rv${number}`, kind: 'review', body: 'Two nits', createdAt: at(12) }),
      inline,
    ],
    threads: [{ id: `t${number}`, path: 'src/a.ts', isResolved: true, comments: [inline] }],
    reviews: [makeReview({ id: `rv${number}`, state: 'COMMENTED', body: 'Two nits', submittedAt: at(12), viewerReacted: true }), makeReview({ id: `ra${number}`, body: '' })],
    ...overrides,
  });
}

/** The PR as 0.21.0 left it: json only, no rows, rows_version 0. */
function storedBefore031(pr: FullPr, fetchedAt = at(1)): void {
  store.prs.upsert(pr, fetchedAt);
  for (const table of ['pr_comment', 'pr_thread', 'pr_review']) {
    store.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(pr.key);
  }
  store.db.prepare("UPDATE pr SET rows_version = 0, mentioned_teams = '[]' WHERE key = ?").run(pr.key);
}

function count(table: string, key?: string): number {
  const where = key === undefined ? '' : ' WHERE pr_key = ?';
  return (store.db.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get(...(key === undefined ? [] : [key])) as { n: number }).n;
}

function header(key: string): { rows_version: number; mentioned_teams: string; snapshot_revision: number } {
  return store.db.prepare('SELECT rows_version, mentioned_teams, snapshot_revision FROM pr WHERE key = ?').get(key) as never;
}

function jsonHas(key: string, field: string): boolean {
  return (store.db.prepare(`SELECT json_type(json, '$.${field}') AS type FROM pr_snapshot WHERE key = ?`).get(key) as { type: string | null }).type !== null;
}

function switchToRows(): void {
  store.meta.set(DISCUSSION_READY_KEY, at(40));
}

describe('migration 031', () => {
  it('adds the tables and header columns to a 030 database and leaves its PRs on the json', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 30);
    const pr = discussedPr(1);
    db.prepare(
      `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams, base_ref, head_ref, head_oid,
         previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision)
       VALUES (?, 'acme/app', 1, 'OPEN', 0, ?, 'alice', '[]', '[]', '[]', 'master', 'branch-1', 'head', '[]', 0, ?, ?, NULL, ?, 3)`,
    ).run(pr.key, pr.title, pr.createdAt, pr.updatedAt, at(1));
    db.prepare(
      `INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
       VALUES (?, 'acme/app', 1, 'OPEN', 'master', 'branch-1', ?, ?, ?)`,
    ).run(pr.key, pr.updatedAt, at(1), JSON.stringify(pr));

    runMigrations(db);

    const migrated = new Store(db);
    expect(db.prepare('SELECT rows_version, mentioned_teams, snapshot_revision FROM pr').get()).toEqual({ rows_version: 0, mentioned_teams: '[]', snapshot_revision: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM pr_comment').get()).toEqual({ n: 0 });
    expect(migrated.prs.getFull(pr.key)).toEqual(pr);
    expect(migrated.prs.nextWithoutRows('discussion', '')).toBe(pr.key);
    expect(migrated.prs.countWithoutRows('discussion')).not.toBe(0);
    db.close();
  });

  it('refuses rows that break the kind, position and flag checks', () => {
    store.prs.upsert(makePr({ number: 1 }), at(1));
    const insert = (kind: string, ord: number | null, threadId: string | null, threadOrd: number | null, reacted: number | null = null) =>
      store.db
        .prepare(
          `INSERT INTO pr_comment (pr_key, id, kind, ord, author, created_at, url, thread_id, thread_ord, viewer_reacted, body)
           VALUES ('acme/app#1', 'x', ?, ?, 'bob', '', '', ?, ?, ?, '')`,
        )
        .run(kind, ord, threadId, threadOrd, reacted);
    expect(() => insert('note', 0, null, null)).toThrow(/CHECK/);
    expect(() => insert('comment', 0, 't1', 0)).toThrow(/CHECK/);
    expect(() => insert('review_comment', null, null, null)).toThrow(/CHECK/);
    expect(() => insert('review_comment', null, null, 0)).toThrow(/CHECK/);
    expect(() => insert('comment', -1, null, null)).toThrow(/CHECK/);
    expect(() => insert('comment', 0, null, null, 2)).toThrow(/CHECK/);
    insert('comment', 0, null, null);
    expect(() => store.db.prepare("INSERT INTO pr_comment (pr_key, id, kind, ord, author, created_at, url, body) VALUES ('acme/app#1', 'y', 'comment', 0, '', '', '', '')").run()).toThrow(
      /UNIQUE/,
    );
  });
});

describe('PrRepo writes the discussion rows on every upsert', () => {
  it('one row per comment, a thread and review row each, the header version and mentioned teams, and the json still whole', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));

    expect([count('pr_comment'), count('pr_thread'), count('pr_review')]).toEqual([3, 1, 2]);
    expect(store.db.prepare('SELECT id, own_body FROM pr_review ORDER BY ord').all()).toEqual([
      { id: 'rv1', own_body: null },
      { id: 'ra1', own_body: '' },
    ]);
    expect(store.db.prepare("SELECT ord, thread_ord, review_id, viewer_reacted FROM pr_comment WHERE id = 'rc1'").get()).toEqual({ ord: 2, thread_ord: 0, review_id: 'rv1', viewer_reacted: 0 });
    expect(header(pr.key)).toMatchObject({ rows_version: NEWEST_ROWS_VERSION, mentioned_teams: '["acme/team-infra","acme/team-platform"]' });
    expect(jsonHas(pr.key, 'comments')).toBe(true);
    expect(store.prs.getFull(pr.key)).toEqual(pr);
  });

  it('drops the row of a comment a refetch no longer brings', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    store.prs.upsert({ ...pr, comments: pr.comments.slice(1) }, at(2));

    expect(store.db.prepare('SELECT id FROM pr_comment ORDER BY ord').all()).toEqual([{ id: 'rv1' }, { id: 'rc1' }]);
    switchToRows();
    expect(store.prs.getFull(pr.key)!.comments.map((comment) => comment.id)).toEqual(['rv1', 'rc1']);
  });

  it('refuses a discussion that does not hold together, and writes nothing', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    const revision = header(pr.key).snapshot_revision;

    expect(() => store.prs.upsert({ ...pr, reviews: [makeReview({ id: 'r' }), makeReview({ id: 'r' })] }, at(2))).toThrow(DiscussionError);
    expect(header(pr.key).snapshot_revision).toBe(revision);
    expect(store.prs.getFull(pr.key)).toEqual(pr);
  });

  it('deletes the rows with the PR, and cascades when only the header goes', () => {
    store.prs.upsert(discussedPr(1), at(1));
    store.prs.upsert(discussedPr(2), at(1));
    store.prs.delete('acme/app#1');
    expect(count('pr_comment', 'acme/app#1')).toBe(0);

    store.db.exec("DELETE FROM pr WHERE key = 'acme/app#2'");
    expect([count('pr_comment'), count('pr_thread'), count('pr_review')]).toEqual([0, 0, 0]);
  });
});

describe('PrRepo.backfillDiscussion', () => {
  it('writes the rows from the json without a new revision, and the PR reads the same from them', () => {
    const pr = discussedPr(1);
    storedBefore031(pr);
    const revision = header(pr.key).snapshot_revision;

    expect(store.prs.backfillDiscussion(pr.key)).toBe(true);

    expect(header(pr.key)).toEqual({ rows_version: 1, mentioned_teams: '["acme/team-infra","acme/team-platform"]', snapshot_revision: revision });
    expect(store.prs.countWithoutRows('discussion')).toBe(0);
    switchToRows();
    store.prs.stripJson('discussion', pr.key);
    expect(store.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
  });

  it('never takes a missing or broken snapshot for one without a discussion', () => {
    const missing = discussedPr(1);
    storedBefore031(missing);
    store.db.exec("DELETE FROM pr_snapshot WHERE key = 'acme/app#1'");
    const differs = discussedPr(2);
    storedBefore031(differs);
    store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.threads[0].comments[0].body', 'edited') WHERE key = ?").run(differs.key);
    const noList = discussedPr(3);
    storedBefore031(noList);
    store.db.prepare("UPDATE pr_snapshot SET json = json_remove(json, '$.reviews') WHERE key = ?").run(noList.key);
    const malformed = discussedPr(4);
    storedBefore031(malformed);
    store.db.prepare("UPDATE pr_snapshot SET json = '{not json' WHERE key = ?").run(malformed.key);

    for (const key of ['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#4']) {
      expect(store.prs.backfillDiscussion(key), key).toBe(false);
      expect(header(key).rows_version, key).toBe(0);
    }
    expect([count('pr_comment'), count('pr_thread'), count('pr_review')]).toEqual([0, 0, 0]);
    expect(store.prs.countWithoutRows('discussion')).not.toBe(0);
  });

  it('walks only the PRs without rows', () => {
    storedBefore031(discussedPr(1));
    store.prs.upsert(discussedPr(2), at(1));
    storedBefore031(discussedPr(3));
    expect(store.prs.nextWithoutRows('discussion', '')).toBe('acme/app#1');
    expect(store.prs.nextWithoutRows('discussion', 'acme/app#1')).toBe('acme/app#3');
    expect(store.prs.nextWithoutRows('discussion', 'acme/app#3')).toBeNull();
  });
});

describe('PrRepo after the switch to rows', () => {
  it('writes the json without the discussion, reads the same PR, and the strip moves no revision', () => {
    const before = discussedPr(1);
    store.prs.upsert(before, at(1));
    switchToRows();
    expect(store.prs.getFull(before.key)).toEqual(canonicalPr(before));

    const revision = header(before.key).snapshot_revision;
    expect(store.prs.stripJson('discussion', before.key)).toBe(true);
    expect(store.prs.stripJson('discussion', before.key)).toBe(false);
    expect(header(before.key).snapshot_revision).toBe(revision);
    expect(['comments', 'threads', 'reviews', 'files'].map((field) => jsonHas(before.key, field))).toEqual([false, false, false, true]);
    expect(store.prs.getFull(before.key)).toEqual(canonicalPr(before));

    const after = discussedPr(2);
    store.prs.upsert(after, at(2));
    expect(jsonHas(after.key, 'comments')).toBe(false);
    expect(store.prs.getMany([after.key]).get(after.key)).toEqual(boardShape(canonicalPr(after)));
    expect(store.prs.listAll()).toEqual([canonicalPr(before), canonicalPr(after)]);
    expect(store.prs.nextAfter('acme/app#1')?.pr).toEqual(canonicalPr(after));
  });

  it('refuses to strip before the switch', () => {
    store.prs.upsert(discussedPr(1), at(1));
    expect(() => store.prs.stripJson('discussion', 'acme/app#1')).toThrow(/rows_ready:discussion/);
    expect(jsonHas('acme/app#1', 'comments')).toBe(true);
  });

  it('keeps cached copies across the switch: the revision did not move and the rows hold the same', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    const cached = store.prs.keepParsed([pr.key]).get(pr.key);

    switchToRows();
    store.prs.stripJson('discussion', pr.key);

    expect(store.prs.keepParsed([pr.key]).get(pr.key)).toBe(cached);
    expect(store.prs.getMany([pr.key]).get(pr.key)).toBe(cached);
  });

  it('leaves out a PR without rows, so the sync fetches it again', () => {
    store.prs.upsert(discussedPr(1), at(1));
    storedBefore031(discussedPr(2));
    store.prs.keepParsed(['acme/app#1', 'acme/app#2']);
    switchToRows();

    expect(store.prs.getFull('acme/app#2')).toBeNull();
    expect([...store.prs.keepParsed(['acme/app#1', 'acme/app#2']).keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.fetchedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.updatedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect(store.prs.fetchedAt('acme/app#2')).toBeNull();
    expect(store.prs.listAll().map((pr) => pr.key)).toEqual(['acme/app#1']);
    expect(store.prs.nextAfter('')?.key).toBe('acme/app#1');
    expect(store.prs.nextAfter('acme/app#1')).toBeNull();
  });

  it('a read-only connection opened after the switch reads the rows, in one read transaction', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.prs.stripJson('discussion', pr.key);

    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
      expect(reader.prs.getMany([pr.key]).get(pr.key)).toEqual(boardShape(canonicalPr(pr)));
      expect(reader.db.isTransaction).toBe(false);
    } finally {
      reader.close();
    }
  });

  it('a reader that cached before the switch reads the rows after it, once the PR changes', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.keepParsed([pr.key]).get(pr.key)).toEqual(boardShape(pr));
      switchToRows();
      store.prs.stripJson('discussion', pr.key);
      const edited = { ...pr, comments: pr.comments.slice(1) };
      store.prs.upsert(edited, at(2));
      expect(reader.prs.keepParsed([pr.key]).get(pr.key)).toEqual(boardShape(canonicalPr(edited)));
    } finally {
      reader.close();
    }
  });

  it('refuses rows that do not hold together instead of reading an empty review', () => {
    const pr = discussedPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.db.prepare("DELETE FROM pr_comment WHERE id = 'rv1'").run();
    expect(() => store.prs.getFull(pr.key)).toThrow(/review rv1 has its body in a comment that is not stored/);
  });
});
