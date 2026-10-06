import type { DatabaseSync } from 'node:sqlite';
import {
  boardReviews,
  boardShape,
  DiscussionError,
  isBodyReadByRules,
  joinDiscussion,
  prTeamMentions,
  splitDiscussion,
  type DiscussionParts,
  type FullPr,
  type Pr,
  type PrHeader,
  type PrKey,
  type PrState,
} from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, each, one, placeholders, run } from '../sql.ts';
import { DISCUSSION_READY_SQL, DiscussionRows, ROWS, STORED_SQL } from './pr-rows.ts';

/** PR rows read and parsed per query (~80 KB of json each on a busy install). */
const PARSE_CHUNK = 200;

/** The meta key of the last snapshot revision handed out (migration 029). */
const SNAPSHOT_REVISION_KEY = 'snapshot_revision';

/** The snapshot json's lists the discussion rows hold (migration 031), as json paths. */
const DISCUSSION_PATHS = "'$.comments', '$.threads', '$.reviews'";

/** A PR without discussion rows: no comment, thread or review. */
const NO_DISCUSSION: DiscussionParts = { comments: [], threads: [], reviews: [] };

/** SQLITE_CONSTRAINT, with any extended code: a row broke a CHECK, NOT NULL or key. */
function isConstraintError(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' && (code & 0xff) === 19;
}

interface ParsedPr {
  revision: number;
  pr: Pr;
}

/**
 * What a read gives: the board shape (`boardShape`: bodies no board rule
 * reads left out, `mentionedTeams` set) or every stored body (`FullPr`).
 */
type ReadShape = 'board' | 'full';

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
function parsePr(text: string): FullPr {
  const parsed = JSON.parse(text) as FullPr & { checks?: unknown };
  if (!('checks' in parsed)) {
    return parsed;
  }
  const { checks: _checks, ...pr } = parsed;
  return pr;
}

/**
 * The PR as its json stores it: never `mentionedTeams` (a read sets it, from
 * the header column), and once reads take the discussion from the rows,
 * without the three lists they hold.
 */
function snapshotJson(pr: FullPr, fromRows: boolean): string {
  const { mentionedTeams: _mentionedTeams, ...stored } = pr;
  if (!fromRows) {
    return JSON.stringify(stored);
  }
  const { comments: _comments, threads: _threads, reviews: _reviews, ...rest } = stored;
  return JSON.stringify(rest);
}

/** A JSON list column; most are empty, which needs no parse. */
function listOf(text: string): string[] {
  return text === '[]' ? [] : (JSON.parse(text) as string[]);
}

/**
 * SQL `postpile_reads_body(author, editor)`: 1 when a board rule reads a
 * body by them (`isBodyReadByRules`), else 0. Registered on every
 * connection a PrRepo reads with, read-only CLI ones included, so the board
 * read leaves bot bodies in SQLite and they never become JS strings. It is
 * the build's own rule at read time: nothing stored can go stale when the
 * bot list changes.
 */
function registerReadsBody(db: DatabaseSync): void {
  db.function('postpile_reads_body', { deterministic: true }, (author, editor) =>
    isBodyReadByRules({ author: String(author), editor: editor === null ? null : String(editor) }) ? 1 : 0,
  );
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
 * existence authority: a PR is stored if and only if it has one), the
 * snapshot json in `pr_snapshot` (the blob being phased out) and, since
 * migration 031, the discussion as child rows (`pr-rows.ts`). All are
 * written together; reads of the json ignore a snapshot without a header.
 *
 * Every upsert writes the discussion rows (rows_version). Reads take the
 * discussion from the json until meta `rows_ready:discussion` is set (the
 * storage job discussion_rows filled the rows of every stored PR), and from
 * the rows after; from then on the json leaves the three lists out
 * (DESIGN.md "PR storage").
 *
 * Every read of PRs runs in one read transaction, so the switch, the header
 * revisions, the snapshots and the rows it takes come from the same commit,
 * also on a read-only connection next to the app's writes (checked with
 * Codex GPT-6.1).
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

  private readonly discussion: DiscussionRows;

  constructor(private readonly db: DatabaseSync) {
    this.discussion = new DiscussionRows(db);
    registerReadsBody(db);
  }

  /**
   * Whether reads take the discussion from its rows (meta
   * `rows_ready:discussion`). Read inside the transaction that reads the
   * PRs, so a switch another connection commits never splits one read.
   */
  readsDiscussionFromRows(): boolean {
    return one<{ ready: number }>(this.db, `SELECT ${DISCUSSION_READY_SQL} AS ready`)?.ready === 1;
  }

  /**
   * These PRs' snapshots, parsed, in board shape or with every body. Before
   * the switch: the json, and for the board `boardShape` of it, so a cached
   * board copy has the same shape on both sides of the switch. After it:
   * the json without the three lists, the discussion joined from the rows
   * (for the board, bodies no board rule reads stay in SQLite, see
   * `postpile_reads_body`) and the header's `mentioned_teams`. Keys without
   * a snapshot are missing. In the caller's read transaction. Rows that do
   * not hold together throw (DiscussionError): every write checks them, so
   * that is a bug, not GitHub data.
   */
  private readChunk(keys: PrKey[], fromRows: boolean, shape: ReadShape): Map<PrKey, Pr> {
    const json = fromRows ? `json_remove(s.json, ${DISCUSSION_PATHS})` : 's.json';
    const rows = all<{ key: string; json: string; mentioned_teams: string }>(
      this.db,
      `SELECT s.key, ${json} AS json, p.mentioned_teams FROM pr_snapshot s JOIN pr p ON p.key = s.key WHERE s.key IN (${placeholders(keys.length)})`,
      ...keys,
    );
    const result = new Map<PrKey, Pr>();
    if (!fromRows) {
      for (const row of rows) {
        const pr = parsePr(row.json);
        result.set(row.key, shape === 'board' ? boardShape(pr) : pr);
      }
      return result;
    }
    const discussion = this.discussion.read(keys, shape === 'board');
    for (const row of rows) {
      const joined = joinDiscussion(discussion.get(row.key) ?? NO_DISCUSSION);
      const pr = { ...parsePr(row.json), ...joined };
      result.set(row.key, shape === 'board' ? { ...pr, reviews: boardReviews(joined.reviews, joined.comments), mentionedTeams: listOf(row.mentioned_teams) } : pr);
    }
    return result;
  }

  /** `readChunk` with every stored body: no read leaves one out then. */
  private readFullChunk(keys: PrKey[], fromRows: boolean): Map<PrKey, FullPr> {
    return this.readChunk(keys, fromRows, 'full') as Map<PrKey, FullPr>;
  }

  /**
   * The given header rows' snapshots in board shape, parsed: cached ones that are still
   * current from the cache, the others read and parsed a chunk at a time
   * (the raw json of a whole board next to its parsed copy went past the
   * main process's 4 GB heap). `keep` says which freshly parsed ones go into
   * the cache. A header whose snapshot is missing is left out and its cache
   * entry dropped: that is an integrity failure, and the sync fetches the PR
   * again (`fetchedAtByKey`, `updatedAtByKey` leave it out too).
   */
  private parse(rows: RevisionRow[], keep: (key: PrKey) => boolean): Map<PrKey, Pr> {
    const stale = rows.filter((row) => this.parsed.get(row.key)?.revision !== row.snapshot_revision);
    const fromRows = stale.length > 0 && this.readsDiscussionFromRows();
    const fresh = new Map<PrKey, Pr>();
    for (let start = 0; start < stale.length; start += PARSE_CHUNK) {
      const chunk = stale.slice(start, start + PARSE_CHUNK);
      const read = this.readChunk(
        chunk.map((row) => row.key),
        fromRows,
        'board',
      );
      for (const row of chunk) {
        const pr = read.get(row.key);
        if (pr === undefined) {
          this.parsed.delete(row.key);
          continue;
        }
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
   * without a header, whose header has lost its snapshot, or (after the
   * switch) without discussion rows, are left out and their cached copies
   * dropped.
   */
  private revisionRows(keys: PrKey[]): RevisionRow[] {
    const rows: RevisionRow[] = [];
    for (let start = 0; start < keys.length; start += PARSE_CHUNK) {
      const chunk = keys.slice(start, start + PARSE_CHUNK);
      rows.push(
        ...all<RevisionRow>(
          this.db,
          `SELECT p.key, p.snapshot_revision FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key IN (${placeholders(chunk.length)}) AND ${STORED_SQL}`,
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
   * Header, snapshot and discussion rows in one transaction: never one
   * without the others. Every write gives the header a new
   * snapshot_revision, so parse caches in this and other processes read the
   * PR again, and the newest rows_version. Until the switch the json keeps
   * the discussion too; after it, the json leaves it out. A discussion that
   * does not hold together throws (DiscussionError) before anything is
   * written.
   */
  upsert(pr: FullPr, fetchedAt: string): void {
    const parts = splitDiscussion(pr);
    const mentionedTeams = JSON.stringify(prTeamMentions(pr));
    inTransaction(this.db, () => {
      // The first statement writes, so the switch read below is the newest one, and stays so until the commit.
      const revision = this.nextRevision();
      const fromRows = this.readsDiscussionFromRows();
      run(
        this.db,
        `INSERT INTO pr (key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams,
           base_ref, head_ref, head_oid, previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at, snapshot_revision,
           rows_version, mentioned_teams)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           repo = excluded.repo, number = excluded.number, state = excluded.state, is_draft = excluded.is_draft,
           title = excluded.title, author = excluded.author, assignees = excluded.assignees,
           reviewer_users = excluded.reviewer_users, reviewer_teams = excluded.reviewer_teams,
           base_ref = excluded.base_ref, head_ref = excluded.head_ref, head_oid = excluded.head_oid,
           previous_base_refs = excluded.previous_base_refs, cross_repository = excluded.cross_repository,
           created_at = excluded.created_at, updated_at = excluded.updated_at, merged_at = excluded.merged_at,
           fetched_at = excluded.fetched_at, snapshot_revision = excluded.snapshot_revision,
           rows_version = excluded.rows_version, mentioned_teams = excluded.mentioned_teams`,
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
        ROWS.discussion,
        mentionedTeams,
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
        snapshotJson(pr, fromRows),
      );
      this.discussion.replace(pr.key, parts);
    });
    // The revision moved anyway; dropping the old copy now frees its memory at once.
    this.parsed.delete(pr.key);
  }

  /** Header, snapshot and discussion rows together (the rows also cascade), and the cached copy. */
  delete(key: PrKey): void {
    inTransaction(this.db, () => {
      this.discussion.replace(key, NO_DISCUSSION);
      run(this.db, 'DELETE FROM pr_snapshot WHERE key = ?', key);
      run(this.db, 'DELETE FROM pr WHERE key = ?', key);
    });
    this.parsed.delete(key);
  }

  /**
   * The stored PR in board shape (a bot body no board rule reads left out,
   * DESIGN.md "The board diet"), the cached copy when it is hot, else read
   * for this call; null without a header (a snapshot alone is not a stored
   * PR), without a snapshot, or (after the switch) without discussion rows.
   */
  get(key: PrKey): Pr | null {
    return this.getMany([key]).get(key) ?? null;
  }

  /** Stored PRs by key, in board shape. A hot PR comes from the cache; any other is parsed for this call only and not kept. */
  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    return keys.length === 0 ? new Map() : inTransaction(this.db, () => this.parse(this.revisionRows(keys), () => false));
  }

  /**
   * The stored PR with every stored body: for event derivation, the write
   * actions, lessons and "Why?" excerpts. Read for this call, never cached.
   * Null when `get` would be.
   */
  getFull(key: PrKey): FullPr | null {
    return this.getFullMany([key]).get(key) ?? null;
  }

  /** Stored PRs by key with every stored body, a chunk at a time; never cached. Keys a read leaves out are missing. */
  getFullMany(keys: PrKey[]): Map<PrKey, FullPr> {
    if (keys.length === 0) {
      return new Map();
    }
    return inTransaction(this.db, () => {
      const rows = this.revisionRows(keys);
      const fromRows = this.readsDiscussionFromRows();
      const result = new Map<PrKey, FullPr>();
      for (let start = 0; start < rows.length; start += PARSE_CHUNK) {
        const read = this.readFullChunk(
          rows.slice(start, start + PARSE_CHUNK).map((row) => row.key),
          fromRows,
        );
        for (const [key, pr] of read) {
          result.set(key, pr);
        }
      }
      return result;
    });
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
   * Every stored PR with every body, parsed for this call. Tests and dev
   * tools only: on a heavy install this is about 2 GB. App code reads
   * `listHeaders`, or `getMany` / `getFullMany` for the PRs it needs.
   */
  listAll(): FullPr[] {
    return inTransaction(this.db, () => {
      const keys = all<{ key: string }>(this.db, `SELECT p.key FROM pr p WHERE ${STORED_SQL} ORDER BY p.repo, p.number`).map((row) => row.key);
      const full = this.getFullMany(keys);
      return keys.flatMap((key) => full.get(key) ?? []);
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
   * header without its snapshot (or, after the switch, its discussion rows)
   * is left out, so the sync fetches it again.
   */
  updatedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; updated_at: string }>(this.db, `SELECT p.key, p.updated_at FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE ${STORED_SQL}`);
    return new Map(rows.map((row) => [row.key, row.updated_at]));
  }

  /** When this PR's stored snapshot was fetched; null when it is not stored. */
  fetchedAt(key: PrKey): string | null {
    return (
      one<{ fetched_at: string }>(this.db, `SELECT p.fetched_at FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key = ? AND ${STORED_SQL}`, key)?.fetched_at ?? null
    );
  }

  /**
   * When each stored snapshot was fetched. A header without its snapshot
   * (or, after the switch, its discussion rows) is left out, so the sync
   * takes it for never fetched and fetches it again.
   */
  fetchedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; fetched_at: string }>(this.db, `SELECT p.key, p.fetched_at FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE ${STORED_SQL}`);
    return new Map(rows.map((row) => [row.key, row.fetched_at]));
  }

  /**
   * The stored PR with the next key after `afterKey` ('' for the first),
   * with the fetched_at its header holds; null after the last. A PR a read
   * leaves out is skipped. Read whole like any read (json, and the
   * discussion rows after the switch), parsed for this call and never
   * cached: for a job that walks every stored PR in small steps and writes
   * some back (`upsert` with the same fetched_at), with no statement left
   * open between them.
   */
  nextAfter(afterKey: PrKey): { key: PrKey; pr: FullPr; fetchedAt: string } | null {
    return inTransaction(this.db, () => {
      const row = one<{ key: string; fetched_at: string }>(
        this.db,
        `SELECT p.key, p.fetched_at FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key > ? AND ${STORED_SQL} ORDER BY p.key LIMIT 1`,
        afterKey,
      );
      if (row === null) {
        return null;
      }
      const pr = this.readFullChunk([row.key], this.readsDiscussionFromRows()).get(row.key);
      return pr === undefined ? null : { key: row.key, pr, fetchedAt: row.fetched_at };
    });
  }

  /** For the storage jobs checks_strip and snapshot_strip: the next stored snapshot's key after `afterKey` ('' for the first); null after the last. */
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

  /** For the storage job discussion_rows: the next PR after `afterKey` ('' for the first) whose discussion rows are not written yet; null after the last. */
  nextWithoutDiscussionRows(afterKey: PrKey): PrKey | null {
    return one<{ key: string }>(this.db, 'SELECT key FROM pr WHERE key > ? AND rows_version < ? ORDER BY key LIMIT 1', afterKey, ROWS.discussion)?.key ?? null;
  }

  /** How many stored PRs have no discussion rows yet (storage_job_blocked). */
  countWithoutDiscussionRows(): number {
    return one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM pr WHERE rows_version < ?', ROWS.discussion)?.n ?? 0;
  }

  /** How many stored snapshots still hold `checks` (storage_job_blocked). */
  countWithChecks(): number {
    return one<{ n: number }>(this.db, "SELECT count(*) AS n FROM pr_snapshot WHERE json_type(json, '$.checks') IS NOT NULL")?.n ?? 0;
  }

  /** Every stored PR has its discussion rows: the check before reads switch to them. A header without its snapshot counts as missing. */
  allHaveDiscussionRows(): boolean {
    return one<{ missing: number }>(this.db, 'SELECT EXISTS (SELECT 1 FROM pr WHERE rows_version < ?) AS missing', ROWS.discussion)?.missing === 0;
  }

  /**
   * Writes one stored PR's discussion rows from its snapshot json, with its
   * mentioned teams and rows_version, inside the caller's transaction; true
   * when it did. The json is read in SQL (`json_extract`), so only the
   * three lists and the body reach JS. No new revision: until the switch
   * reads take the json, which holds the same discussion.
   *
   * False, with nothing written, for a snapshot that is missing, not valid
   * json, lacks a list, or does not hold together (a DiscussionError, a row
   * a constraint refuses). Such a PR never counts as having rows: it is
   * never taken for one without a discussion, and the switch waits until a
   * fetch stores it again.
   */
  backfillDiscussion(key: PrKey): boolean {
    // One json_extract of four paths gives them as one json array: SQLite parses the blob once, and JS only these parts.
    const row = one<{ parts: string | null }>(
      this.db,
      `SELECT CASE WHEN json_valid(json) THEN json_extract(json, '$.body', '$.comments', '$.threads', '$.reviews') END AS parts
       FROM pr_snapshot WHERE key = ?`,
      key,
    );
    if (row === null || row.parts === null) {
      return false;
    }
    const [body, comments, threads, reviews] = JSON.parse(row.parts) as unknown[];
    if (typeof body !== 'string' || !Array.isArray(comments) || !Array.isArray(threads) || !Array.isArray(reviews)) {
      return false;
    }
    const discussion = { body, comments: comments as FullPr['comments'], threads: threads as FullPr['threads'], reviews: reviews as FullPr['reviews'] };
    this.db.exec('SAVEPOINT backfill_discussion');
    try {
      this.discussion.replace(key, splitDiscussion(discussion));
      run(this.db, 'UPDATE pr SET rows_version = ?, mentioned_teams = ? WHERE key = ?', ROWS.discussion, JSON.stringify(prTeamMentions(discussion)), key);
      this.db.exec('RELEASE backfill_discussion');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK TO backfill_discussion');
      this.db.exec('RELEASE backfill_discussion');
      if (error instanceof DiscussionError || isConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Removes the discussion lists from one stored snapshot's json, in SQL,
   * when it holds any; true when it did. Only after the switch (throws
   * before it): reads take them from the rows then. No new revision: no
   * read changes.
   */
  stripDiscussion(key: PrKey): boolean {
    if (!this.readsDiscussionFromRows()) {
      throw new Error('the discussion is still read from the snapshot json (rows_ready:discussion is not set)');
    }
    return (
      run(
        this.db,
        `UPDATE pr_snapshot SET json = json_remove(json, ${DISCUSSION_PATHS})
         WHERE key = ? AND (json_type(json, '$.comments') IS NOT NULL OR json_type(json, '$.threads') IS NOT NULL OR json_type(json, '$.reviews') IS NOT NULL)`,
        key,
      ) > 0
    );
  }
}
