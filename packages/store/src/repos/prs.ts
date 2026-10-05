import type { DatabaseSync } from 'node:sqlite';
import type { Pr, PrKey } from '@postpile/core';
import { all, one, placeholders, run } from '../sql.ts';

/** PR rows read and parsed per query when the cache fills (~80 KB of json each on a busy install). */
const PARSE_CHUNK = 200;

interface ParsedPr {
  fetchedAt: string;
  pr: Pr;
}

export class PrRepo {
  /**
   * Parsed snapshots by key, with the fetched_at they were stored with. The
   * json blobs are large (comments, review threads: ~15 MB for ~150 PRs) and
   * every read model loads all PRs, so parsing them on each request cost
   * ~45 ms. A row is parsed again once its fetched_at changes, which also
   * catches writes from another process (the CLI). Callers must not mutate
   * the returned PRs.
   */
  private readonly parsed = new Map<PrKey, ParsedPr>();

  constructor(private readonly db: DatabaseSync) {}

  /**
   * Parses the json of the given keys that are missing from the cache or
   * older than their row. A chunk at a time: the raw json strings of a
   * whole cold start (~1 GB for ~11k PRs) next to their parsed copies went
   * past the main process's 4 GB heap.
   */
  private refreshParsed(rows: Array<{ key: string; fetched_at: string }>): void {
    const stale = rows.filter((row) => this.parsed.get(row.key)?.fetchedAt !== row.fetched_at).map((row) => row.key);
    for (let start = 0; start < stale.length; start += PARSE_CHUNK) {
      const chunk = stale.slice(start, start + PARSE_CHUNK);
      const fresh = all<{ key: string; fetched_at: string; json: string }>(
        this.db,
        `SELECT key, fetched_at, json FROM pr WHERE key IN (${placeholders(chunk.length)})`,
        ...chunk,
      );
      for (const row of fresh) {
        this.parsed.set(row.key, { fetchedAt: row.fetched_at, pr: JSON.parse(row.json) as Pr });
      }
    }
  }

  upsert(pr: Pr, fetchedAt: string): void {
    run(
      this.db,
      `INSERT INTO pr (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
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
    // Two upserts can share a fetched_at, so never trust the cache after one.
    this.parsed.delete(pr.key);
  }

  get(key: PrKey): Pr | null {
    const row = one<{ json: string }>(this.db, 'SELECT json FROM pr WHERE key = ?', key);
    return row ? (JSON.parse(row.json) as Pr) : null;
  }

  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    const result = new Map<PrKey, Pr>();
    if (keys.length === 0) {
      return result;
    }
    const rows = all<{ key: string; fetched_at: string }>(
      this.db,
      `SELECT key, fetched_at FROM pr WHERE key IN (${placeholders(keys.length)})`,
      ...keys,
    );
    this.refreshParsed(rows);
    for (const row of rows) {
      const cached = this.parsed.get(row.key);
      if (cached) {
        result.set(row.key, cached.pr);
      }
    }
    return result;
  }

  /** Ordered by number. */
  listByRepo(repo: string): Pr[] {
    return all<{ json: string }>(this.db, 'SELECT json FROM pr WHERE repo = ? ORDER BY number', repo).map(
      (row) => JSON.parse(row.json) as Pr,
    );
  }

  /** Every stored PR, for stack detection across topics. */
  listAll(): Pr[] {
    const rows = all<{ key: string; fetched_at: string }>(this.db, 'SELECT key, fetched_at FROM pr ORDER BY repo, number');
    this.refreshParsed(rows);
    return rows.flatMap((row) => this.parsed.get(row.key)?.pr ?? []);
  }

  /** updated_at per stored PR, so sync can skip PRs that did not move. */
  updatedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; updated_at: string }>(this.db, 'SELECT key, updated_at FROM pr');
    return new Map(rows.map((row) => [row.key, row.updated_at]));
  }

  /** When this PR's stored snapshot was fetched; null when it is not stored. */
  fetchedAt(key: PrKey): string | null {
    return one<{ fetched_at: string }>(this.db, 'SELECT fetched_at FROM pr WHERE key = ?', key)?.fetched_at ?? null;
  }

  /** When each stored snapshot was fetched. */
  fetchedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; fetched_at: string }>(this.db, 'SELECT key, fetched_at FROM pr');
    return new Map(rows.map((row) => [row.key, row.fetched_at]));
  }
}
