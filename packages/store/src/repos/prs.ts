import type { DatabaseSync } from 'node:sqlite';
import type { LightPr, Pr, PrKey, PrState } from '@postpile/core';
import { all, each, one, placeholders, run } from '../sql.ts';

/** PR rows read and parsed per query (~80 KB of json each on a busy install). */
const PARSE_CHUNK = 200;

interface ParsedPr {
  fetchedAt: string;
  pr: Pr;
}

interface LightRow {
  key: string;
  repo: string;
  number: number;
  state: string;
  base_ref: string;
  head_ref: string;
  updated_at: string;
  title: string;
  author: string;
  assignees: string;
  reviewer_users: string;
  reviewer_teams: string;
  created_at: string;
  merged_at: string | null;
  previous_base_refs: string;
  cross_repository: number;
  last_event_at: string | null;
}

/** A JSON list column; most are empty, which needs no parse. */
function listOf(text: string): string[] {
  return text === '[]' ? [] : (JSON.parse(text) as string[]);
}

function toLight(row: LightRow): LightPr {
  return {
    key: row.key,
    ref: { repo: row.repo, number: row.number },
    state: row.state as PrState,
    baseRef: row.base_ref,
    headRef: row.head_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at,
    previousBaseRefs: listOf(row.previous_base_refs),
    isCrossRepository: row.cross_repository !== 0,
    title: row.title,
    author: row.author,
    assignees: listOf(row.assignees),
    reviewerUsers: listOf(row.reviewer_users),
    reviewerTeams: listOf(row.reviewer_teams),
    lastEventAt: row.last_event_at,
  };
}

export class PrRepo {
  /**
   * Parsed snapshots of the hot board's PRs (`keepParsed`), with the
   * fetched_at they were stored with. The json blobs are large (comments,
   * review threads: ~80 KB a PR on a busy install) and every read model
   * loads the board, so parsing them on each request cost ~45 ms. Only the
   * hot PRs stay: a cache of every PR held ~1.9 GB on a heavy install. A
   * row is parsed again once its fetched_at changes, which also catches
   * writes from another process (the CLI). Callers must not mutate the
   * returned PRs.
   */
  private readonly parsed = new Map<PrKey, ParsedPr>();

  constructor(private readonly db: DatabaseSync) {}

  /**
   * The given rows parsed: cached ones that are still current from the
   * cache, the others read and parsed a chunk at a time (the raw json of a
   * whole board next to its parsed copy went past the main process's 4 GB
   * heap). `keep` says which freshly parsed ones go into the cache.
   */
  private parse(rows: Array<{ key: string; fetched_at: string }>, keep: (key: PrKey) => boolean): Map<PrKey, Pr> {
    const stale = rows.filter((row) => this.parsed.get(row.key)?.fetchedAt !== row.fetched_at).map((row) => row.key);
    const fresh = new Map<PrKey, Pr>();
    for (let start = 0; start < stale.length; start += PARSE_CHUNK) {
      const chunk = stale.slice(start, start + PARSE_CHUNK);
      const read = all<{ key: string; fetched_at: string; json: string }>(
        this.db,
        `SELECT key, fetched_at, json FROM pr WHERE key IN (${placeholders(chunk.length)})`,
        ...chunk,
      );
      for (const row of read) {
        const pr = JSON.parse(row.json) as Pr;
        fresh.set(row.key, pr);
        if (keep(row.key)) {
          this.parsed.set(row.key, { fetchedAt: row.fetched_at, pr });
        }
      }
    }
    // In the order of `rows`, so callers see the same order whether a PR came from the cache or not.
    const result = new Map<PrKey, Pr>();
    for (const row of rows) {
      const pr = fresh.get(row.key) ?? this.parsed.get(row.key)?.pr;
      if (pr) {
        result.set(row.key, pr);
      }
    }
    return result;
  }

  private fetchedAtRows(keys: PrKey[]): Array<{ key: string; fetched_at: string }> {
    const rows: Array<{ key: string; fetched_at: string }> = [];
    for (let start = 0; start < keys.length; start += PARSE_CHUNK) {
      const chunk = keys.slice(start, start + PARSE_CHUNK);
      rows.push(...all<{ key: string; fetched_at: string }>(this.db, `SELECT key, fetched_at FROM pr WHERE key IN (${placeholders(chunk.length)})`, ...chunk));
    }
    return rows;
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
    run(
      this.db,
      `INSERT OR REPLACE INTO pr_light
         (key, title, author, assignees, reviewer_users, reviewer_teams, created_at, merged_at, previous_base_refs, cross_repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pr.key,
      pr.title,
      pr.author,
      JSON.stringify(pr.assignees ?? []),
      JSON.stringify(pr.reviewerUsers),
      JSON.stringify(pr.reviewerTeams),
      pr.createdAt,
      pr.mergedAt,
      JSON.stringify(pr.previousBaseRefs ?? []),
      pr.isCrossRepository ? 1 : 0,
    );
    // Two upserts can share a fetched_at, so never trust the cache after one.
    this.parsed.delete(pr.key);
  }

  get(key: PrKey): Pr | null {
    const row = one<{ json: string }>(this.db, 'SELECT json FROM pr WHERE key = ?', key);
    return row ? (JSON.parse(row.json) as Pr) : null;
  }

  /** Stored PRs by key. A hot PR comes from the cache; any other is parsed for this call only and not kept. */
  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    return keys.length === 0 ? new Map() : this.parse(this.fetchedAtRows(keys), () => false);
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
    return this.parse(this.fetchedAtRows(keys), (key) => wanted.has(key));
  }

  /**
   * Every stored snapshot, parsed for this call. Tests and dev tools only:
   * on a heavy install this is about 2 GB. App code reads `listLight`, or
   * `getMany` for the PRs it needs.
   */
  listAll(): Pr[] {
    const rows = all<{ key: string; fetched_at: string }>(this.db, 'SELECT key, fetched_at FROM pr ORDER BY repo, number');
    return [...this.parse(rows, () => false).values()];
  }

  /** Every stored key. */
  keys(): PrKey[] {
    return all<{ key: string }>(this.db, 'SELECT key FROM pr ORDER BY key').map((row) => row.key);
  }

  /**
   * Every stored PR without its snapshot, with the time of its newest
   * stored event: the pr row's short columns and its pr_light row
   * (migration 028), never the json. Stacks
   * over every PR, the hot rules and the search read these; ~11k rows read
   * in tens of milliseconds where parsing the snapshots took seconds.
   */
  listLight(): LightPr[] {
    const rows = each<LightRow>(
      this.db,
      `SELECT pr.key, pr.repo, pr.number, pr.state, pr.base_ref, pr.head_ref, pr.updated_at, l.title, l.author, l.assignees,
         l.reviewer_users, l.reviewer_teams, l.created_at, l.merged_at, l.previous_base_refs, l.cross_repository,
         (SELECT max(at) FROM pr_event WHERE pr_event.pr_key = pr.key) AS last_event_at
       FROM pr JOIN pr_light l ON l.key = pr.key
       ORDER BY pr.repo, pr.number`,
    );
    const result: LightPr[] = [];
    for (const row of rows) {
      result.push(toLight(row));
    }
    return result;
  }

  /** Open, merged or closed per stored PR. */
  stateByKey(): Map<PrKey, PrState> {
    const rows = all<{ key: string; state: string }>(this.db, 'SELECT key, state FROM pr');
    return new Map(rows.map((row) => [row.key, row.state as PrState]));
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
