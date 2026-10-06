// The text and short fields as rows (migration 034, DESIGN.md "PR
// storage"): every upsert writes the header's text columns and the body
// row, a backfill fills them from the json of PRs stored before, and once
// `rows_ready:text` is set no read takes anything from the snapshot json.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boardShape, canonicalPr, type FullPr } from '@postpile/core';
import { at, makeComment, makeCommit, makePr } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_READY_KEY, DISCUSSION_READY_KEY, NEWEST_ROWS_VERSION, ROWS, runMigrations, Store, TEXT_READY_KEY } from './index.ts';

let dir: string;
let path: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-text-'));
  path = join(dir, 'db.sqlite');
  store = Store.open(path);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A PR with every text field set: labels in GitHub's order, a merger, cap hits, a description. */
function textPr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  return makePr({
    number,
    body: `Fixes the runner (#${number}).\n\ncc @acme/team-infra`,
    labels: ['zeta', 'Alpha'],
    state: 'MERGED',
    mergedAt: at(9),
    mergedBy: 'trunk-io[bot]',
    additions: 120,
    deletions: 7,
    changedFiles: 3,
    reviewDecision: 'APPROVED',
    truncated: true,
    capHits: [{ list: 'comments', nodes: 100, oldestAt: at(2), cursor: 'Y3Vy' }],
    previousBaseRefs: ['old-base'],
    isCrossRepository: false,
    comments: [makeComment({ id: `c${number}` })],
    commits: [makeCommit({ oid: `o${number}` })],
    ...overrides,
  });
}

/** A PR the way older builds stored it: no assignees, truncated or capHits, previousBaseRefs or isCrossRepository. */
function olderPr(number: number): FullPr {
  const pr = textPr(number);
  delete pr.assignees;
  delete pr.truncated;
  delete pr.capHits;
  delete pr.previousBaseRefs;
  delete pr.isCrossRepository;
  return pr;
}

/** The PR as an install whose activity rows are done left it: no text rows, rows_version 2. */
function storedBefore034(pr: FullPr, fetchedAt = at(1)): void {
  store.prs.upsert(pr, fetchedAt);
  store.db.prepare('DELETE FROM pr_body WHERE pr_key = ?').run(pr.key);
  store.db
    .prepare(
      `UPDATE pr SET rows_version = ?, url = '', additions = 0, deletions = 0, changed_files = 0, labels = '[]', review_decision = 'NONE',
         merged_by = NULL, truncated = NULL, cap_hits = NULL, absent_fields = '[]' WHERE key = ?`,
    )
    .run(ROWS.activity, pr.key);
}

function header(key: string): Record<string, unknown> {
  return store.db
    .prepare('SELECT rows_version, snapshot_revision, url, labels, merged_by, truncated, cap_hits, absent_fields FROM pr WHERE key = ?')
    .get(key) as Record<string, unknown>;
}

function json(key: string): string {
  return (store.db.prepare('SELECT json FROM pr_snapshot WHERE key = ?').get(key) as { json: string }).json;
}

function lowerSwitches(): void {
  store.meta.set(DISCUSSION_READY_KEY, at(40));
  store.meta.set(ACTIVITY_READY_KEY, at(41));
}

function switchToRows(): void {
  lowerSwitches();
  store.meta.set(TEXT_READY_KEY, at(42));
}

describe('migration 034', () => {
  it('adds the columns and pr_body to a 033 database and leaves its PRs on the json', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 33);
    const pr = textPr(1, { comments: [], commits: [] });
    db.prepare(
      `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams, base_ref, head_ref, head_oid,
         previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision, rows_version)
       VALUES (?, 'acme/app', 1, 'MERGED', 0, ?, 'alice', '[]', '[]', '[]', 'master', 'branch-1', 'head', '["old-base"]', 0, ?, ?, ?, ?, 3, 2)`,
    ).run(pr.key, pr.title, pr.createdAt, pr.updatedAt, pr.mergedAt, at(1));
    db.prepare(
      `INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
       VALUES (?, 'acme/app', 1, 'MERGED', 'master', 'branch-1', ?, ?, ?)`,
    ).run(pr.key, pr.updatedAt, at(1), JSON.stringify({ ...pr, comments: [], threads: [], reviews: [], commits: [], timeline: [], files: [] }));

    runMigrations(db);

    const migrated = new Store(db);
    migrated.meta.set(DISCUSSION_READY_KEY, at(40));
    migrated.meta.set(ACTIVITY_READY_KEY, at(41));
    expect(db.prepare('SELECT url, truncated, cap_hits, absent_fields FROM pr').get()).toEqual({ url: '', truncated: null, cap_hits: null, absent_fields: '[]' });
    expect(migrated.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
    expect(migrated.prs.nextWithoutRows('text', '')).toBe(pr.key);
    expect(migrated.prs.countWithoutRows('text')).not.toBe(0);
    db.close();
  });
});

describe('PrRepo writes the text rows on every upsert', () => {
  it('the text columns, the body row and the newest version, the json still whole', () => {
    const pr = textPr(1);
    store.prs.upsert(pr, at(1));

    expect(header(pr.key)).toMatchObject({
      rows_version: NEWEST_ROWS_VERSION,
      url: pr.url,
      labels: '["zeta","Alpha"]',
      merged_by: 'trunk-io[bot]',
      truncated: 1,
      cap_hits: JSON.stringify(pr.capHits),
      absent_fields: '[]',
    });
    expect(store.db.prepare('SELECT body FROM pr_body').all()).toEqual([{ body: pr.body }]);
    expect(JSON.parse(json(pr.key))).toMatchObject({ body: pr.body, labels: pr.labels });
  });

  it('keeps what older snapshots lack as missing: NULL, not false or []', () => {
    const pr = olderPr(1);
    store.prs.upsert(pr, at(1));
    expect(header(pr.key)).toMatchObject({ truncated: null, cap_hits: null, absent_fields: '["assignees","previousBaseRefs","isCrossRepository"]' });

    store.prs.upsert({ ...pr, truncated: false, capHits: [] }, at(2));
    expect(header(pr.key)).toMatchObject({ truncated: 0, cap_hits: '[]' });
  });

  it('deletes the body row with the PR', () => {
    store.prs.upsert(textPr(1), at(1));
    store.prs.delete('acme/app#1');
    expect(store.db.prepare('SELECT count(*) AS n FROM pr_body').get()).toEqual({ n: 0 });
  });
});

describe('PrRepo.backfillText', () => {
  it('writes the rows from the json without a new revision, and the PR reads the same from them', () => {
    const pr = textPr(1);
    storedBefore034(pr);
    const revision = header(pr.key).snapshot_revision;

    expect(store.prs.backfillText(pr.key)).toBe(true);

    expect(header(pr.key)).toMatchObject({ rows_version: ROWS.text, snapshot_revision: revision, url: pr.url, cap_hits: JSON.stringify(pr.capHits) });
    expect(store.prs.countWithoutRows('text')).toBe(0);
    switchToRows();
    expect(store.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
  });

  it('keeps what an older snapshot lacks as missing', () => {
    const pr = olderPr(1);
    storedBefore034(pr);
    expect(store.prs.backfillText(pr.key)).toBe(true);
    switchToRows();
    const back = store.prs.getFull(pr.key)!;
    for (const field of ['assignees', 'truncated', 'capHits', 'previousBaseRefs', 'isCrossRepository']) {
      expect(back, field).not.toHaveProperty(field);
    }
    expect(back).toEqual(canonicalPr(pr));
  });

  it('never takes a missing or broken snapshot for one without text', () => {
    const cases: Array<[number, string | null]> = [
      [1, null],
      [2, "json_remove(json, '$.url')"],
      [3, "json_set(json, '$.labels', json('[1]'))"],
      [4, "json_remove(json, '$.mergedBy')"],
      [5, "json_set(json, '$.truncated', 'yes')"],
      [6, "'{not json'"],
    ];
    for (const [number, change] of cases) {
      storedBefore034(textPr(number));
      if (change === null) {
        store.db.prepare('DELETE FROM pr_snapshot WHERE key = ?').run(`acme/app#${number}`);
      } else {
        store.db.prepare(`UPDATE pr_snapshot SET json = ${change} WHERE key = ?`).run(`acme/app#${number}`);
      }
    }
    for (const [number] of cases) {
      const key = `acme/app#${number}`;
      expect(store.prs.backfillText(key), key).toBe(false);
      expect(header(key).rows_version, key).toBe(ROWS.activity);
    }
    expect(store.db.prepare('SELECT count(*) AS n FROM pr_body').get()).toEqual({ n: 0 });
    expect(store.prs.countWithoutRows('text')).not.toBe(0);
  });

  it('raises only a PR at the activity version: rows_version is cumulative', () => {
    const pr = textPr(1);
    storedBefore034(pr);
    store.db.prepare('UPDATE pr SET rows_version = ? WHERE key = ?').run(ROWS.discussion, pr.key);
    expect(store.prs.backfillText(pr.key)).toBe(false);
    expect(header(pr.key).rows_version).toBe(ROWS.discussion);
  });
});

describe('PrRepo after the switch to text rows', () => {
  it('reads no json: the same PR with the snapshot json emptied, and upserts write no snapshot', () => {
    const before = textPr(1);
    store.prs.upsert(before, at(1));
    switchToRows();
    store.db.exec("UPDATE pr_snapshot SET json = '{}'");

    expect(store.prs.getFull(before.key)).toEqual(canonicalPr(before));
    expect(store.prs.get(before.key)).toEqual(boardShape(canonicalPr(before)));

    const after = textPr(2);
    store.prs.upsert(after, at(2));
    expect(store.db.prepare('SELECT count(*) AS n FROM pr_snapshot WHERE key = ?').get(after.key)).toEqual({ n: 0 });
    expect(store.prs.listAll()).toEqual([canonicalPr(before), canonicalPr(after)]);
    expect(store.prs.nextAfter('acme/app#1')?.pr).toEqual(canonicalPr(after));
  });

  it('keeps cached copies across the switch: the revision did not move and the rows hold the same', () => {
    const pr = olderPr(1);
    store.prs.upsert(pr, at(1));
    lowerSwitches();
    const cached = store.prs.keepParsed([pr.key]).get(pr.key);

    store.meta.set(TEXT_READY_KEY, at(42));

    expect(store.prs.keepParsed([pr.key]).get(pr.key)).toBe(cached);
    // A fresh read from the rows, in another connection without a cache, equals the cached copy, missing fields missing.
    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.get(pr.key)).toStrictEqual(cached);
    } finally {
      reader.close();
    }
  });

  it('leaves out a PR below the text version or without its body row, so the sync fetches it again', () => {
    store.prs.upsert(textPr(1), at(1));
    storedBefore034(textPr(2));
    store.prs.upsert(textPr(3), at(1));
    store.db.exec("DELETE FROM pr_body WHERE pr_key = 'acme/app#3'");
    switchToRows();

    expect(store.prs.getFull('acme/app#2')).toBeNull();
    expect(store.prs.getFull('acme/app#3')).toBeNull();
    expect([...store.prs.keepParsed(['acme/app#1', 'acme/app#2']).keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.fetchedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect([...store.prs.updatedAtByKey().keys()]).toEqual(['acme/app#1']);
    expect(store.prs.fetchedAt('acme/app#2')).toBeNull();
  });

  it('a read-only connection opened after the switch reads the rows', () => {
    const pr = textPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.db.exec("UPDATE pr_snapshot SET json = '{}'");

    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
      expect(reader.db.isTransaction).toBe(false);
    } finally {
      reader.close();
    }
  });

  it('refuses a text switch set before the lists switched', () => {
    store.prs.upsert(textPr(1), at(1));
    store.meta.set(TEXT_READY_KEY, at(42));
    expect(() => store.prs.getFull('acme/app#1')).toThrow(/rows_ready:text is set before/);
  });
});
