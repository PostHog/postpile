import type { DatabaseSync } from 'node:sqlite';
import {
  ActivityError,
  boardReviews,
  boardShape,
  DiscussionError,
  isBodyReadByRules,
  joinActivity,
  joinDiscussion,
  joinText,
  prTeamMentions,
  splitActivity,
  splitDiscussion,
  splitText,
  type ActivityParts,
  type CapHit,
  type DiscussionParts,
  type FullPr,
  type HeaderPart,
  type Pr,
  type PrHeader,
  type Commit,
  type PrFile,
  type PrKey,
  type PrState,
  type PrTextFields,
  type ReviewDecision,
  type TimelineItem,
} from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, each, one, placeholders, run } from '../sql.ts';
import {
  ActivityRows,
  DiscussionRows,
  NEWEST_ROWS_VERSION,
  READY_KEYS,
  ROWS,
  storedRowsVersion,
  TEXT_COLUMNS_SQL,
  TextRows,
  toTextPart,
  type RowsCollection,
  type TextRow,
} from './pr-rows.ts';

/** PR rows read and parsed per query (~80 KB of json each on a busy install). */
const PARSE_CHUNK = 200;

/** The meta key of the last snapshot revision handed out (migration 029). */
const SNAPSHOT_REVISION_KEY = 'snapshot_revision';

/** The snapshot json's fields each collection's rows hold: the discussion (migration 031), the activity lists (033), the rest (034). */
const JSON_FIELDS: Record<RowsCollection, Array<keyof FullPr>> = {
  discussion: ['comments', 'threads', 'reviews'],
  activity: ['commits', 'timeline', 'files'],
  text: [
    'key',
    'ref',
    'title',
    'url',
    'body',
    'author',
    'assignees',
    'state',
    'isDraft',
    'baseRef',
    'headRef',
    'additions',
    'deletions',
    'changedFiles',
    'labels',
    'reviewDecision',
    'reviewerUsers',
    'reviewerTeams',
    'headOid',
    'createdAt',
    'updatedAt',
    'mergedAt',
    'mergedBy',
    'previousBaseRefs',
    'isCrossRepository',
    'truncated',
    'capHits',
  ],
};

/** A PR without discussion rows: no comment, thread or review. */
const NO_DISCUSSION: DiscussionParts = { comments: [], threads: [], reviews: [] };

/** A PR without activity rows: no commit, timeline item or file. */
const NO_ACTIVITY: ActivityParts = { commits: [], timeline: [], files: [] };

/** The json paths of these collections' fields, as SQL string literals for `json_remove` (fixed names, nothing from data). */
function jsonPaths(collections: Iterable<RowsCollection>): string[] {
  return [...collections].flatMap((collection) => JSON_FIELDS[collection].map((field) => `'$.${field}'`));
}

/**
 * SQL over `pr p`: the stored PRs, given which collections reads take from
 * rows. Before the text switch a header counts with its snapshot, at the
 * rows_version the switched collections need. After it, `pr_snapshot` is
 * never named (snapshot_retire drops it): a header counts with its body row
 * at the newest version. Anything less is an integrity failure that reads
 * leave out, so the sync fetches the PR again. Ends in a WHERE clause
 * callers can extend with AND.
 */
function storedPrs(ready: ReadonlySet<RowsCollection>): string {
  if (ready.has('text')) {
    return `pr p JOIN pr_body b ON b.pr_key = p.key WHERE p.rows_version >= ${storedRowsVersion(ready)}`;
  }
  return `pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.rows_version >= ${storedRowsVersion(ready)}`;
}

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

/** The header columns of a `pr` row. */
interface HeaderColumnsRow {
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
}

interface HeaderRow extends HeaderColumnsRow {
  last_event_at: string | null;
}

/** SQL: the columns of `HeaderColumnsRow`, over the header `p`. */
const HEADER_COLUMNS_SQL = `p.key, p.repo, p.number, p.state, p.is_draft, p.title, p.author, p.assignees, p.reviewer_users, p.reviewer_teams,
  p.base_ref, p.head_ref, p.head_oid, p.previous_base_refs, p.cross_repository, p.created_at, p.updated_at, p.merged_at`;

/** A PR's header and text rows, with its mentioned teams: what a read takes once the text is in rows. */
type HeaderAndTextRow = HeaderColumnsRow & TextRow & { mentioned_teams: string };

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
 * the header column), and without the fields of every collection reads
 * take from rows.
 */
function snapshotJson(pr: FullPr, ready: ReadonlySet<RowsCollection>): string {
  const stored: Partial<FullPr> = { ...pr };
  delete stored.mentionedTeams;
  for (const collection of ready) {
    for (const field of JSON_FIELDS[collection]) {
      delete stored[field];
    }
  }
  return JSON.stringify(stored);
}

/** A json value as an object's fields, or null when it is not an object. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A stored commit with every field a row needs, the committer optional (older snapshots lack it). */
function isStoredCommit(value: unknown): value is Commit {
  const c = fieldsOf(value);
  return (
    c !== null &&
    typeof c.oid === 'string' &&
    typeof c.headline === 'string' &&
    typeof c.author === 'string' &&
    typeof c.committedAt === 'string' &&
    (c.committer === undefined || typeof c.committer === 'string')
  );
}

function isStoredTimelineItem(value: unknown): value is TimelineItem {
  const t = fieldsOf(value);
  return t !== null && typeof t.id === 'string' && typeof t.kind === 'string' && typeof t.actor === 'string' && typeof t.at === 'string' && (t.subject === null || typeof t.subject === 'string');
}

function isStoredFile(value: unknown): value is PrFile {
  const f = fieldsOf(value);
  return f !== null && typeof f.path === 'string' && typeof f.additions === 'number' && typeof f.deletions === 'number';
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The text fields of a stored snapshot's json, or null when one the rows
 * need is missing or of the wrong type. `truncated` and `capHits` may be
 * missing (older snapshots), and the optional header fields are only
 * looked at for whether they are there.
 */
function storedTextFields(value: unknown): PrTextFields | null {
  const f = fieldsOf(value);
  if (
    f === null ||
    typeof f.url !== 'string' ||
    typeof f.body !== 'string' ||
    typeof f.additions !== 'number' ||
    typeof f.deletions !== 'number' ||
    typeof f.changedFiles !== 'number' ||
    !isStringList(f.labels) ||
    typeof f.reviewDecision !== 'string' ||
    !(f.mergedBy === null || typeof f.mergedBy === 'string') ||
    !(f.truncated === undefined || typeof f.truncated === 'boolean') ||
    !(f.capHits === undefined || (Array.isArray(f.capHits) && f.capHits.every((hit) => fieldsOf(hit) !== null)))
  ) {
    return null;
  }
  const fields: PrTextFields = {
    url: f.url,
    body: f.body,
    additions: f.additions,
    deletions: f.deletions,
    changedFiles: f.changedFiles,
    labels: f.labels,
    reviewDecision: f.reviewDecision as ReviewDecision,
    mergedBy: f.mergedBy,
  };
  if (f.truncated !== undefined) {
    fields.truncated = f.truncated;
  }
  if (f.capHits !== undefined) {
    fields.capHits = f.capHits as CapHit[];
  }
  // Only whether they are there counts (`splitText` names the absent ones): their values live in the header columns.
  if (f.assignees !== undefined) {
    fields.assignees = [];
  }
  if (f.previousBaseRefs !== undefined) {
    fields.previousBaseRefs = [];
  }
  if (f.isCrossRepository !== undefined) {
    fields.isCrossRepository = false;
  }
  return fields;
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

function toHeaderPart(row: HeaderColumnsRow): HeaderPart {
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
  };
}

function toHeader(row: HeaderRow): PrHeader {
  return { ...toHeaderPart(row), lastEventAt: row.last_event_at };
}

/**
 * Stored PRs (DESIGN.md "PR storage"): the header in `pr` (the existence
 * authority: a PR is stored if and only if it has one, migration 028) and
 * its rows (`pr-rows.ts`): the discussion since migration 031, the activity
 * lists since 033, the text columns and body row since 034. Until the last
 * switch, the snapshot json in `pr_snapshot` too, the blob being phased
 * out. All are written together; reads of the json ignore a snapshot
 * without a header.
 *
 * Every upsert writes every collection's rows and the newest rows_version.
 * Reads take a collection from the json until its meta flag
 * `rows_ready:<collection>` is set (its storage job filled the rows of
 * every stored PR), and from the rows after; from then on the json leaves
 * that collection out. Once `rows_ready:text` is set no code names
 * `pr_snapshot` any more but the storage job snapshot_retire, which empties
 * and drops it.
 *
 * Every read of PRs runs in one read transaction, so the flags, the header
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

  private readonly activity: ActivityRows;

  private readonly text: TextRows;

  constructor(private readonly db: DatabaseSync) {
    this.discussion = new DiscussionRows(db);
    this.activity = new ActivityRows(db);
    this.text = new TextRows(db);
    registerReadsBody(db);
  }

  /**
   * Which collections reads take from rows (meta `rows_ready:<collection>`).
   * Read inside the transaction that reads the PRs, so a switch another
   * connection commits never splits one read.
   */
  readyCollections(): Set<RowsCollection> {
    const keys = Object.values(READY_KEYS);
    const set = new Set(all<{ key: string }>(this.db, `SELECT key FROM meta WHERE key IN (${placeholders(keys.length)})`, ...keys).map((row) => row.key));
    const ready = new Set<RowsCollection>();
    for (const [collection, key] of Object.entries(READY_KEYS) as Array<[RowsCollection, string]>) {
      if (set.has(key)) {
        ready.add(collection);
      }
    }
    return ready;
  }

  /** Whether reads take the discussion from its rows (meta `rows_ready:discussion`). */
  readsDiscussionFromRows(): boolean {
    return this.readyCollections().has('discussion');
  }

  /**
   * These PRs from the snapshot json, without the fields of the
   * collections in `ready` (`json_remove` in SQL): the json part of a read
   * before the text switch. Typed whole, though the switched fields are
   * missing: `readChunk` joins them from the rows. Keys without a snapshot
   * are missing.
   */
  private readJsonBases(keys: PrKey[], ready: ReadonlySet<RowsCollection>): Map<PrKey, { pr: FullPr; mentionedTeams: string }> {
    const paths = jsonPaths(ready);
    const json = paths.length === 0 ? 's.json' : `json_remove(s.json, ${paths.join(', ')})`;
    const rows = all<{ key: string; json: string; mentioned_teams: string }>(
      this.db,
      `SELECT s.key, ${json} AS json, p.mentioned_teams FROM pr_snapshot s JOIN pr p ON p.key = s.key WHERE s.key IN (${placeholders(keys.length)})`,
      ...keys,
    );
    return new Map(rows.map((row) => [row.key, { pr: parsePr(row.json), mentionedTeams: row.mentioned_teams }]));
  }

  /**
   * These PRs from their header and text rows: the base of a read once the
   * text switched, no json involved. Typed whole like `readJsonBases`; the
   * lists come from their rows. Keys without a body row are missing.
   */
  private readTextBases(keys: PrKey[]): Map<PrKey, { pr: FullPr; mentionedTeams: string }> {
    const rows = all<HeaderAndTextRow>(
      this.db,
      `SELECT ${HEADER_COLUMNS_SQL}, p.mentioned_teams, ${TEXT_COLUMNS_SQL}
       FROM pr p JOIN pr_body b ON b.pr_key = p.key WHERE p.key IN (${placeholders(keys.length)})`,
      ...keys,
    );
    return new Map(rows.map((row) => [row.key, { pr: joinText(toHeaderPart(row), toTextPart(row)) as FullPr, mentionedTeams: row.mentioned_teams }]));
  }

  /**
   * These PRs, in board shape or with every body. Each collection comes
   * from its rows once its switch is set, else from the snapshot json; once
   * the text switched, no json is read at all. The discussion: before its
   * switch the json, and for the board `boardShape` of it, so a cached
   * board copy has the same shape on both sides of the switch; after it,
   * the rows (for the board, bodies no board rule reads stay in SQLite, see
   * `postpile_reads_body`) and the header's `mentioned_teams`. Keys a read
   * finds nothing for are missing. In the caller's read transaction. Rows
   * that do not hold together throw (DiscussionError, ActivityError):
   * every write checks them, so that is a bug, not GitHub data.
   */
  private readChunk(keys: PrKey[], ready: ReadonlySet<RowsCollection>, shape: ReadShape): Map<PrKey, Pr> {
    if (ready.has('text') && !(ready.has('discussion') && ready.has('activity'))) {
      // The jobs switch in order; only a hand-set flag gets here.
      throw new Error('rows_ready:text is set before rows_ready:discussion and rows_ready:activity');
    }
    const bases = ready.has('text') ? this.readTextBases(keys) : this.readJsonBases(keys, ready);
    const activity = ready.has('activity') ? this.activity.read(keys) : null;
    const discussion = ready.has('discussion') ? this.discussion.read(keys, shape === 'board') : null;
    const result = new Map<PrKey, Pr>();
    for (const [key, base] of bases) {
      let pr = base.pr;
      if (activity !== null) {
        pr = { ...pr, ...joinActivity(activity.get(key) ?? NO_ACTIVITY) };
      }
      if (discussion === null) {
        result.set(key, shape === 'board' ? boardShape(pr) : pr);
        continue;
      }
      const joined = joinDiscussion(discussion.get(key) ?? NO_DISCUSSION);
      const withRows = { ...pr, ...joined };
      result.set(key, shape === 'board' ? { ...withRows, reviews: boardReviews(joined.reviews, joined.comments), mentionedTeams: listOf(base.mentionedTeams) } : withRows);
    }
    return result;
  }

  /** `readChunk` with every stored body: no read leaves one out then. */
  private readFullChunk(keys: PrKey[], ready: ReadonlySet<RowsCollection>): Map<PrKey, FullPr> {
    return this.readChunk(keys, ready, 'full') as Map<PrKey, FullPr>;
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
  private parse(rows: RevisionRow[], ready: ReadonlySet<RowsCollection>, keep: (key: PrKey) => boolean): Map<PrKey, Pr> {
    const stale = rows.filter((row) => this.parsed.get(row.key)?.revision !== row.snapshot_revision);
    const fresh = new Map<PrKey, Pr>();
    for (let start = 0; start < stale.length; start += PARSE_CHUNK) {
      const chunk = stale.slice(start, start + PARSE_CHUNK);
      const read = this.readChunk(
        chunk.map((row) => row.key),
        ready,
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
   * without a header, whose header has lost its snapshot, or whose
   * rows_version is below what the switched collections need, are left out
   * and their cached copies dropped.
   */
  private revisionRows(keys: PrKey[], ready: ReadonlySet<RowsCollection>): RevisionRow[] {
    const rows: RevisionRow[] = [];
    for (let start = 0; start < keys.length; start += PARSE_CHUNK) {
      const chunk = keys.slice(start, start + PARSE_CHUNK);
      rows.push(...all<RevisionRow>(this.db, `SELECT p.key, p.snapshot_revision FROM ${storedPrs(ready)} AND p.key IN (${placeholders(chunk.length)})`, ...chunk));
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
   * The snapshot row, until the text switched: the json without the fields
   * of the collections reads take from rows. Its own short columns are
   * legacy: written for NOT NULL, never read.
   */
  private writeSnapshot(pr: FullPr, fetchedAt: string, ready: ReadonlySet<RowsCollection>): void {
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
      snapshotJson(pr, ready),
    );
  }

  /**
   * Header, snapshot and every collection's rows in one transaction: never
   * one without the others. Every write gives the header a new
   * snapshot_revision, so parse caches in this and other processes read the
   * PR again, and the newest rows_version. Until the text switched, the
   * snapshot json too, without the collections reads take from rows; after
   * it, no snapshot (the table is being retired). Rows that do not hold
   * together throw (DiscussionError, ActivityError) before anything is
   * written.
   */
  upsert(pr: FullPr, fetchedAt: string): void {
    const discussion = splitDiscussion(pr);
    const activity = splitActivity(pr);
    const text = splitText(pr);
    const mentionedTeams = JSON.stringify(prTeamMentions(pr));
    inTransaction(this.db, () => {
      // The first statement writes, so the flags read below are the newest ones, and stay so until the commit.
      const revision = this.nextRevision();
      const ready = this.readyCollections();
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
        NEWEST_ROWS_VERSION,
        mentionedTeams,
      );
      if (!ready.has('text')) {
        this.writeSnapshot(pr, fetchedAt, ready);
      }
      this.discussion.replace(pr.key, discussion);
      this.activity.replace(pr.key, activity);
      this.text.replace(pr.key, text);
    });
    // The revision moved anyway; dropping the old copy now frees its memory at once.
    this.parsed.delete(pr.key);
  }

  /** Header, snapshot (until the text switched) and rows together (the rows also cascade), and the cached copy. */
  delete(key: PrKey): void {
    inTransaction(this.db, () => {
      this.discussion.replace(key, NO_DISCUSSION);
      this.activity.replace(key, NO_ACTIVITY);
      if (!this.readyCollections().has('text')) {
        run(this.db, 'DELETE FROM pr_snapshot WHERE key = ?', key);
      }
      run(this.db, 'DELETE FROM pr WHERE key = ?', key);
    });
    this.parsed.delete(key);
  }

  /**
   * The stored PR in board shape (a bot body no board rule reads left out,
   * DESIGN.md "The board diet"), the cached copy when it is hot, else read
   * for this call; null without a header (a snapshot alone is not a stored
   * PR), without a snapshot, or without the rows a switched collection
   * needs.
   */
  get(key: PrKey): Pr | null {
    return this.getMany([key]).get(key) ?? null;
  }

  /** Stored PRs by key, in board shape. A hot PR comes from the cache; any other is parsed for this call only and not kept. */
  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    if (keys.length === 0) {
      return new Map();
    }
    return inTransaction(this.db, () => {
      const ready = this.readyCollections();
      return this.parse(this.revisionRows(keys, ready), ready, () => false);
    });
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
      const ready = this.readyCollections();
      const rows = this.revisionRows(keys, ready);
      const result = new Map<PrKey, FullPr>();
      for (let start = 0; start < rows.length; start += PARSE_CHUNK) {
        const read = this.readFullChunk(
          rows.slice(start, start + PARSE_CHUNK).map((row) => row.key),
          ready,
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
    return inTransaction(this.db, () => {
      const ready = this.readyCollections();
      return this.parse(this.revisionRows(keys, ready), ready, (key) => wanted.has(key));
    });
  }

  /**
   * Every stored PR with every body, parsed for this call. Tests and dev
   * tools only: on a heavy install this is about 2 GB. App code reads
   * `listHeaders`, or `getMany` / `getFullMany` for the PRs it needs.
   */
  listAll(): FullPr[] {
    return inTransaction(this.db, () => {
      const keys = all<{ key: string }>(this.db, `SELECT p.key FROM ${storedPrs(this.readyCollections())} ORDER BY p.repo, p.number`).map((row) => row.key);
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
   * header without its snapshot or below the rows_version the switched
   * collections need is left out, so the sync fetches it again.
   */
  updatedAtByKey(): Map<PrKey, string> {
    return inTransaction(this.db, () => {
      const rows = all<{ key: string; updated_at: string }>(this.db, `SELECT p.key, p.updated_at FROM ${storedPrs(this.readyCollections())}`);
      return new Map(rows.map((row) => [row.key, row.updated_at]));
    });
  }

  /** When this PR's stored snapshot was fetched; null when it is not stored. */
  fetchedAt(key: PrKey): string | null {
    return inTransaction(
      this.db,
      () => one<{ fetched_at: string }>(this.db, `SELECT p.fetched_at FROM ${storedPrs(this.readyCollections())} AND p.key = ?`, key)?.fetched_at ?? null,
    );
  }

  /**
   * When each stored snapshot was fetched. A header without its snapshot
   * or below the rows_version the switched collections need is left out,
   * so the sync takes it for never fetched and fetches it again.
   */
  fetchedAtByKey(): Map<PrKey, string> {
    return inTransaction(this.db, () => {
      const rows = all<{ key: string; fetched_at: string }>(this.db, `SELECT p.key, p.fetched_at FROM ${storedPrs(this.readyCollections())}`);
      return new Map(rows.map((row) => [row.key, row.fetched_at]));
    });
  }

  /**
   * The stored PR with the next key after `afterKey` ('' for the first),
   * with the fetched_at its header holds; null after the last. A PR a read
   * leaves out is skipped. Read whole like any read (the json and the rows
   * of every switched collection), parsed for this call and never cached:
   * for a job that walks every stored PR in small steps and writes some
   * back (`upsert` with the same fetched_at), with no statement left open
   * between them.
   */
  nextAfter(afterKey: PrKey): { key: PrKey; pr: FullPr; fetchedAt: string } | null {
    return inTransaction(this.db, () => {
      const ready = this.readyCollections();
      const row = one<{ key: string; fetched_at: string }>(this.db, `SELECT p.key, p.fetched_at FROM ${storedPrs(ready)} AND p.key > ? ORDER BY p.key LIMIT 1`, afterKey);
      if (row === null) {
        return null;
      }
      const pr = this.readFullChunk([row.key], ready).get(row.key);
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

  /** For a collection's backfill job: the next PR after `afterKey` ('' for the first) whose rows of it are not written yet; null after the last. */
  nextWithoutRows(collection: RowsCollection, afterKey: PrKey): PrKey | null {
    return one<{ key: string }>(this.db, 'SELECT key FROM pr WHERE key > ? AND rows_version < ? ORDER BY key LIMIT 1', afterKey, ROWS[collection])?.key ?? null;
  }

  /** How many stored PRs have no rows of this collection yet (storage_job_blocked). */
  countWithoutRows(collection: RowsCollection): number {
    return one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM pr WHERE rows_version < ?', ROWS[collection])?.n ?? 0;
  }

  /** Every stored PR has this collection's rows: the check before reads switch to them. */
  allHaveRows(collection: RowsCollection): boolean {
    return one<{ missing: number }>(this.db, 'SELECT EXISTS (SELECT 1 FROM pr WHERE rows_version < ?) AS missing', ROWS[collection])?.missing === 0;
  }

  /** How many stored snapshots still hold `checks` (storage_job_blocked). */
  countWithChecks(): number {
    return one<{ n: number }>(this.db, "SELECT count(*) AS n FROM pr_snapshot WHERE json_type(json, '$.checks') IS NOT NULL")?.n ?? 0;
  }

  /**
   * One PR's rows written by `write` inside a savepoint of the caller's
   * transaction; true when they were. Data that does not hold together (a
   * DiscussionError or ActivityError, a row a constraint refuses) rolls the
   * savepoint back and gives false; anything else throws.
   */
  private writeOrRefuse(write: () => void): boolean {
    this.db.exec('SAVEPOINT backfill_rows');
    try {
      write();
      this.db.exec('RELEASE backfill_rows');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK TO backfill_rows');
      this.db.exec('RELEASE backfill_rows');
      if (error instanceof DiscussionError || error instanceof ActivityError || isConstraintError(error)) {
        return false;
      }
      throw error;
    }
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
    return this.writeOrRefuse(() => {
      this.discussion.replace(key, splitDiscussion(discussion));
      run(this.db, 'UPDATE pr SET rows_version = ?, mentioned_teams = ? WHERE key = ?', ROWS.discussion, JSON.stringify(prTeamMentions(discussion)), key);
    });
  }

  /**
   * Writes one stored PR's activity rows (commits, timeline, files) from
   * its snapshot json and raises its rows_version to the activity's, inside
   * the caller's transaction; true when it did. Only from the discussion's
   * version: rows_version is cumulative, so a PR without its discussion
   * rows is never raised past them. No new revision: until the switch
   * reads take the json, which holds the same lists.
   *
   * False, with nothing written, for a snapshot that is missing, not valid
   * json, lacks a list or a field of an item, or does not hold together (an
   * ActivityError, a row a constraint refuses), and for a PR not at the
   * discussion's version.
   * Such a PR keeps its version: the switch waits until a fetch stores it
   * again, and it is never taken for one without commits.
   */
  backfillActivity(key: PrKey): boolean {
    const row = one<{ rows_version: number; parts: string | null }>(
      this.db,
      `SELECT p.rows_version, CASE WHEN json_valid(s.json) THEN json_extract(s.json, '$.commits', '$.timeline', '$.files') END AS parts
       FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key = ?`,
      key,
    );
    if (row === null || row.parts === null || row.rows_version !== ROWS.discussion) {
      return false;
    }
    const [commits, timeline, files] = JSON.parse(row.parts) as unknown[];
    if (
      !Array.isArray(commits) ||
      !Array.isArray(timeline) ||
      !Array.isArray(files) ||
      !commits.every(isStoredCommit) ||
      !timeline.every(isStoredTimelineItem) ||
      !files.every(isStoredFile)
    ) {
      return false;
    }
    const activity = { commits, timeline, files };
    return this.writeOrRefuse(() => {
      this.activity.replace(key, splitActivity(activity));
      run(this.db, 'UPDATE pr SET rows_version = ? WHERE key = ?', ROWS.activity, key);
    });
  }

  /**
   * Writes one stored PR's text rows (the header's text columns and the
   * body row) from its snapshot json and raises its rows_version to the
   * text's, inside the caller's transaction; true when it did. Only from
   * the activity's version (rows_version is cumulative). The header's own
   * columns stay as they are: every upsert wrote them from the same PR as
   * the json. No new revision: until the switch reads take the json, which
   * holds the same fields.
   *
   * False, with nothing written, for a snapshot that is missing, not valid
   * json or lacks a field the rows need (a missing `truncated` or
   * `capHits` is kept as missing, not refused), and for a PR not at the
   * activity's version. Such a PR keeps its version and the switch waits.
   */
  backfillText(key: PrKey): boolean {
    // The lists are not needed: SQLite leaves them out (already stripped on most installs).
    const row = one<{ rows_version: number; json: string | null }>(
      this.db,
      `SELECT p.rows_version, CASE WHEN json_valid(s.json) THEN json_remove(s.json, ${jsonPaths(['discussion', 'activity']).join(', ')}) END AS json
       FROM pr p JOIN pr_snapshot s ON s.key = p.key WHERE p.key = ?`,
      key,
    );
    if (row === null || row.json === null || row.rows_version !== ROWS.activity) {
      return false;
    }
    const fields = storedTextFields(JSON.parse(row.json));
    if (fields === null) {
      return false;
    }
    return this.writeOrRefuse(() => {
      this.text.replace(key, splitText(fields));
      run(this.db, 'UPDATE pr SET rows_version = ? WHERE key = ?', ROWS.text, key);
    });
  }

  /**
   * Removes a switched collection's fields from one stored snapshot's json,
   * in SQL, when it holds any; true when it did. Only after the switch
   * (throws before it): reads take them from the rows then. No new
   * revision: no read changes.
   */
  stripJson(collection: RowsCollection, key: PrKey): boolean {
    if (!this.readyCollections().has(collection)) {
      throw new Error(`the ${collection} is still read from the snapshot json (${READY_KEYS[collection]} is not set)`);
    }
    const paths = jsonPaths([collection]);
    const holdsAny = paths.map((path) => `json_type(json, ${path}) IS NOT NULL`).join(' OR ');
    return run(this.db, `UPDATE pr_snapshot SET json = json_remove(json, ${paths.join(', ')}) WHERE key = ? AND (${holdsAny})`, key) > 0;
  }

  /** Whether `pr_snapshot` still exists: snapshot_retire drops it once it is empty. */
  hasSnapshotTable(): boolean {
    return one<{ name: string }>(this.db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pr_snapshot'") !== null;
  }

  /**
   * For the storage job snapshot_retire: deletes one stored snapshot, the
   * next after `afterKey` ('' for the first), and returns its key; null
   * when none is left or the table is gone. Only once no read takes the
   * json (throws before `rows_ready:text`): upserts no longer write it then,
   * so nothing comes back behind the cursor.
   */
  retireNextSnapshot(afterKey: PrKey): PrKey | null {
    if (!this.readyCollections().has('text')) {
      throw new Error(`the snapshot json is still read (${READY_KEYS.text} is not set)`);
    }
    if (!this.hasSnapshotTable()) {
      return null;
    }
    const key = this.nextSnapshotKey(afterKey);
    if (key !== null) {
      run(this.db, 'DELETE FROM pr_snapshot WHERE key = ?', key);
    }
    return key;
  }

  /**
   * For snapshot_retire's check: drops `pr_snapshot` once it is empty
   * (instant then, no page is rewritten); true when the table is gone.
   * False, with the table kept, while it still holds a row. Always named
   * with IF EXISTS: no later code may fail on the missing table.
   */
  dropEmptySnapshotTable(): boolean {
    if (this.hasSnapshotTable() && one<{ n: number }>(this.db, 'SELECT EXISTS (SELECT 1 FROM pr_snapshot) AS n')?.n === 1) {
      return false;
    }
    this.db.exec('DROP TABLE IF EXISTS pr_snapshot');
    return true;
  }
}
