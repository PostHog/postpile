import type { DatabaseSync } from 'node:sqlite';
import type { Pr, PrHeader, PrKey, PrState } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, each, one, placeholders, run } from '../sql.ts';

/** PR rows read and parsed per query (~80 KB of json each on a busy install). */
const PARSE_CHUNK = 200;

/** The meta key of the last snapshot revision handed out (migration 029). */
const SNAPSHOT_REVISION_KEY = 'snapshot_revision';

interface ParsedPr {
  revision: number;
  pr: Pr;
}

/** A header's key and the revision of its snapshot (migration 029): what a cached copy is checked against. */
interface RevisionRow {
  key: string;
  snapshot_revision: number;
}

interface HeaderRow {
  key: string;
  repo: string;
  number: number;
  state: string;
  is_draft: number;
  title: string;
  author: string;
  assignees: string;
  reviewer_users: string;
  reviewer_teams: string;
  base_ref: string;
  head_ref: string;
  head_oid: string;
  previous_base_refs: string;
  cross_repository: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  last_event_at: string | null;
}

/**
 * A stored snapshot, parsed, without the `checks` builds before 0.21.0
 * wrote (DESIGN.md "CI is not tracked"). Until the storage job checks_strip
 * has reached a PR its json still holds them; dropping them here keeps them
 * out of memory and out of anything written back (a local rewrite stores
 * what it read).
 */
function parsePr(text: string): Pr {
  const parsed = JSON.parse(text) as Pr & { checks?: unknown };
  if (!('checks' in parsed)) {
    return parsed;
  }
  const { checks: _checks, ...pr } = parsed;
  return pr;
}

/** A JSON list column; most are empty, which needs no parse. */
function listOf(text: string): string[] {
  return text === '[]' ? [] : (JSON.parse(text) as string[]);
}

function toHeader(row: HeaderRow): PrHeader {
  return {
    key: row.key,
    ref: { repo: row.repo, number: row.number },
    state: row.state as PrState,
    isDraft: row.is_draft !== 0,
    title: row.title,
    author: row.author,
    assignees: listOf(row.assignees),
    reviewerUsers: listOf(row.reviewer_users),
    reviewerTeams: listOf(row.reviewer_teams),
    baseRef: row.base_ref,
    headRef: row.head_ref,
    headOid: row.head_oid,
    previousBaseRefs: listOf(row.previous_base_refs),
    isCrossRepository: row.cross_repository !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at,
    lastEventAt: row.last_event_at,
  };
}

/**
 * Stored PRs (migration 028): the header in `pr` (short columns, the
 * existence authority: a PR is stored if and only if it has one) and the
 * snapshot json in `pr_snapshot` (the blob being phased out). Both are
 * written together; reads of the json ignore a snapshot without a header.
 *
 * Every read of PRs runs in one read transaction, so the header revisions
 * and the snapshots it takes come from the same commit, also on a read-only
 * connection next to the app's writes (checked with Codex GPT-6.1).
 */
export class PrRepo {
  /**
   * Parsed snapshots of the hot board's PRs (`keepParsed`), with the
   * snapshot revision they were read at. The json blobs are large
   * (comments, review threads: ~80 KB a PR on a busy install) and every
   * read model loads the board, so parsing them on each request cost
   * ~45 ms. Only the hot PRs stay: a cache of every PR held ~1.9 GB on a
   * heavy install. A row is parsed again once its revision moves, which
   * every snapshot write does, a local rewrite that keeps the fetch time
   * too, and in another process as well (the CLI). Callers must not mutate
   * the returned PRs.
   */
  private readonly parsed = new Map<PrKey, ParsedPr>();

  constructor(private readonly db: DatabaseSync) {}

  /**
   * The given header rows' snapshots, parsed: cached ones that are still
   * current from the cache, the others read and parsed a chunk at a time
   * (the raw json of a whole board next to its parsed copy went past the
   * main process's 4 GB heap). `keep` says which freshly parsed ones go into
   * the cache. A header whose snapshot is missing is left out and its cache
   * entry dropped: that is an integrity failure, and the sync fetches the PR
   * again (`fetchedAtByKey`, `updatedAtByKey` leave it out too).
   */
  private parse(rows: RevisionRow[], keep: (key: PrKey) => boolean): Map<PrKey, Pr> {
    const stale = rows.filter((row) => this.parsed.get(row.key)?.revision !== row.snapshot_revision);
    const fresh = new Map<PrKey, Pr>();
    for (let start = 0; start < stale.length; start += PARSE_CHUNK) {
      const chunk = stale.slice(start, start + PARSE_CHUNK);
      const read = all<{ key: string; json: string }>(
        this.db,
        `SELECT key, json FROM pr_snapshot WHERE key IN (${placeholders(chunk.length)})`,
        ...chunk.map((row) => row.key),
      );
      const json = new Map(read.map((row) => [row.key, row.json]));
      for (const row of chunk) {
        const text = json.get(row.key);
        if (text === undefined) {
          this.parsed.delete(row.key);
          continue;
        }
        const pr = parsePr(text);
        fresh.set(row.key, pr);
        if (keep(row.key)) {
          this.parsed.set(row.key, { revision: row.snapshot_revision, pr });
        }
      }
    }
    // In the order of `rows`, so callers see the same order whether a PR came from the cache or not.
    const result = new Map<PrKey, Pr>();
    for (const row of rows) {
      const cached = this.parsed.get(row.key);
      const pr = fresh.get(row.key) ?? (cached?.revision === row.snapshot_revision ? cached.pr : undefined);
      if (pr) {
        result.set(row.key, pr);
      }
    }
    return result;
  }

  /**
   * The headers' snapshot revisions for these keys, a chunk at a time. Keys
   * without a header, or whose header has lost its snapshot, are left out
   * and their cached copies dropped.
   */
  private revisionRows(keys: PrKey[]): RevisionRow[] {
    const rows: RevisionRow[] = [];
    for (let start = 0; start < keys.length; start += PARSE_CHUNK) {
      const chunk = keys.slice(start, start + PARSE_CHUNK);
      rows.push(
        ...all<RevisionRow>(
          this.db,
          `SELECT p.key, p.snapshot_revision FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key IN (${placeholders(chunk.length)})`,
          ...chunk,
        ),
      );
    }
    const stored = new Set(rows.map((row) => row.key));
    for (const key of keys) {
      if (!stored.has(key)) {
        this.parsed.delete(key);
      }
    }
    return rows;
  }

  /**
   * The next snapshot revision, from one counter for the whole store that
   * only goes up: a revision is never handed out twice, not even to a PR
   * deleted and stored again, so a cache never takes another snapshot for
   * the one it holds.
   */
  private nextRevision(): number {
    const row = one<{ value: string }>(
      this.db,
      `INSERT INTO meta (key, value) VALUES (?, '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
       RETURNING value`,
      SNAPSHOT_REVISION_KEY,
    );
    return Number(row?.value);
  }

  /**
   * Header first, then snapshot, in one transaction: never one without the
   * other. Every write gives the header a new snapshot_revision, so parse
   * caches in this and other processes read the snapshot again.
   */
  upsert(pr: Pr, fetchedAt: string): void {
    inTransaction(this.db, () => {
      const revision = this.nextRevision();
      run(
        this.db,
        `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams,
           base_ref, head_ref, head_oid, previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           repo = excluded.repo, number = excluded.number, state = excluded.state, is_draft = excluded.is_draft,
           title = excluded.title, author = excluded.author, assignees = excluded.assignees,
           reviewer_users = excluded.reviewer_users, reviewer_teams = excluded.reviewer_teams,
           base_ref = excluded.base_ref, head_ref = excluded.head_ref, head_oid = excluded.head_oid,
           previous_base_refs = excluded.previous_base_refs, cross_repository = excluded.cross_repository,
           created_at = excluded.created_at, updated_at = excluded.updated_at, merged_at = excluded.merged_at,
           fetched_at = excluded.fetched_at, snapshot_revision = excluded.snapshot_revision`,
        pr.key,
        pr.ref.repo,
        pr.ref.number,
        pr.state,
        pr.isDraft ? 1 : 0,
        pr.title,
        pr.author,
        JSON.stringify(pr.assignees ?? []),
        JSON.stringify(pr.reviewerUsers),
        JSON.stringify(pr.reviewerTeams),
        pr.baseRef,
        pr.headRef,
        pr.headOid,
        JSON.stringify(pr.previousBaseRefs ?? []),
        pr.isCrossRepository ? 1 : 0,
        pr.createdAt,
        pr.updatedAt,
        pr.mergedAt,
        fetchedAt,
        revision,
      );
      // The snapshot's own short columns are legacy: written for NOT NULL, never read.
      run(
        this.db,
        `INSERT INTO pr_snapshot (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           repo = excluded.repo, number = excluded.number, state = excluded.state,
           base_ref = excluded.base_ref, head_ref = excluded.head_ref, updated_at = excluded.updated_at,
           fetched_at = excluded.fetched_at, json = excluded.json`,
        pr.key,
        pr.ref.repo,
        pr.ref.number,
        pr.state,
        pr.baseRef,
        pr.headRef,
        pr.updatedAt,
        fetchedAt,
        JSON.stringify(pr),
      );
    });
    // The revision moved anyway; dropping the old copy now frees its memory at once.
    this.parsed.delete(pr.key);
  }

  /** Header and snapshot together, and the cached copy. */
  delete(key: PrKey): void {
    inTransaction(this.db, () => {
      run(this.db, 'DELETE FROM pr_snapshot WHERE key = ?', key);
      run(this.db, 'DELETE FROM pr WHERE key = ?', key);
    });
    this.parsed.delete(key);
  }

  /** The stored snapshot; null without a header (a snapshot alone is not a stored PR) or without a snapshot. */
  get(key: PrKey): Pr | null {
    const row = one<{ json: string }>(this.db, 'SELECT s.json FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key = ?', key);
    return row ? parsePr(row.json) : null;
  }

  /** Stored PRs by key. A hot PR comes from the cache; any other is parsed for this call only and not kept. */
  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    return keys.length === 0 ? new Map() : inTransaction(this.db, () => this.parse(this.revisionRows(keys), () => false));
  }

  /**
   * The hot board's read: these PRs, parsed and kept in the cache, and
   * every other cached PR let go. The cache then holds the hot set and
   * nothing more, however many PRs are stored.
   */
  keepParsed(keys: PrKey[]): Map<PrKey, Pr> {
    const wanted = new Set(keys);
    for (const key of this.parsed.keys()) {
      if (!wanted.has(key)) {
        this.parsed.delete(key);
      }
    }
    return inTransaction(this.db, () => this.parse(this.revisionRows(keys), (key) => wanted.has(key)));
  }

  /**
   * Every stored snapshot, parsed for this call. Tests and dev tools only:
   * on a heavy install this is about 2 GB. App code reads `listHeaders`, or
   * `getMany` for the PRs it needs.
   */
  listAll(): Pr[] {
    return inTransaction(this.db, () => {
      const rows = all<RevisionRow>(this.db, 'SELECT key, snapshot_revision FROM pr ORDER BY repo, number');
      return [...this.parse(rows, () => false).values()];
    });
  }

  /** Every stored key. */
  keys(): PrKey[] {
    return all<{ key: string }>(this.db, 'SELECT key FROM pr ORDER BY key').map((row) => row.key);
  }

  /**
   * Every stored PR's header with the time of its newest stored event,
   * from `pr` alone, never the json. Stacks over every PR, the hot rules
   * and the search read these: ~11k rows in tens of milliseconds, where
   * parsing their snapshots took seconds.
   */
  listHeaders(): PrHeader[] {
    const rows = each<HeaderRow>(
      this.db,
      `SELECT key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams,
         base_ref, head_ref, head_oid, previous_base_refs, cross_repository, created_at, updated_at, merged_at,
         (SELECT max(at) FROM pr_event WHERE pr_event.pr_key = pr.key) AS last_event_at
       FROM pr ORDER BY repo, number`,
    );
    const result: PrHeader[] = [];
    for (const row of rows) {
      result.push(toHeader(row));
    }
    return result;
  }

  /** Open, merged or closed per stored PR. */
  stateByKey(): Map<PrKey, PrState> {
    const rows = all<{ key: string; state: string }>(this.db, 'SELECT key, state FROM pr');
    return new Map(rows.map((row) => [row.key, row.state as PrState]));
  }

  /**
   * updated_at per stored PR, so sync can skip PRs that did not move. A
   * header without its snapshot is left out, so the sync fetches it again.
   */
  updatedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; updated_at: string }>(this.db, 'SELECT p.key, p.updated_at FROM pr p JOIN pr_snapshot s ON s.key = p.key');
    return new Map(rows.map((row) => [row.key, row.updated_at]));
  }

  /** When this PR's stored snapshot was fetched; null when it is not stored. */
  fetchedAt(key: PrKey): string | null {
    return one<{ fetched_at: string }>(this.db, 'SELECT p.fetched_at FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key = ?', key)?.fetched_at ?? null;
  }

  /**
   * When each stored snapshot was fetched. A header without its snapshot is
   * left out, so the sync takes it for never fetched and fetches it again.
   */
  fetchedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; fetched_at: string }>(this.db, 'SELECT p.key, p.fetched_at FROM pr p JOIN pr_snapshot s ON s.key = p.key');
    return new Map(rows.map((row) => [row.key, row.fetched_at]));
  }

  /**
   * The stored PR with the next key after `afterKey` ('' for the first),
   * with the fetched_at its header holds; null after the last. A header
   * without its snapshot is skipped. One row per call, parsed for this call
   * and never cached: for a job that walks every stored PR in small steps
   * and writes some back (`upsert` with the same fetched_at), with no
   * statement left open between them.
   */
  nextAfter(afterKey: PrKey): { key: PrKey; pr: Pr; fetchedAt: string } | null {
    const row = one<{ key: string; fetched_at: string; json: string }>(
      this.db,
      'SELECT p.key, p.fetched_at, s.json FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key > ? ORDER BY p.key LIMIT 1',
      afterKey,
    );
    return row === null ? null : { key: row.key, pr: parsePr(row.json), fetchedAt: row.fetched_at };
  }

  /** For the storage job checks_strip: the next stored snapshot's key after `afterKey` ('' for the first); null after the last. */
  nextSnapshotKey(afterKey: PrKey): PrKey | null {
    return one<{ key: string }>(this.db, 'SELECT key FROM pr_snapshot WHERE key > ? ORDER BY key LIMIT 1', afterKey)?.key ?? null;
  }

  /**
   * Removes `checks` from one stored snapshot's json, in SQL, when it holds
   * them; true when it did. No new revision: reads drop them anyway
   * (`parsePr`), so no read changes.
   */
  stripChecks(key: PrKey): boolean {
    return (
      run(this.db, "UPDATE pr_snapshot SET json = json_remove(json, '$.checks') WHERE key = ? AND json_type(json, '$.checks') IS NOT NULL", key) > 0
    );
  }
}
