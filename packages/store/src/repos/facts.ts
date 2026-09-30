import type { DatabaseSync } from 'node:sqlite';
import type {
  EntityKind,
  EntityRef,
  Fact,
  FactPredicate,
  FactQuery,
  FactRef,
  FactRefKind,
  FactSource,
  PrKey,
  StaleReason,
} from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, placeholders, run, type SqlValue } from '../sql.ts';

export interface FactClosing {
  /** World time the fact stopped being true. */
  invalidAt: string;
  reason: string;
  /** The fact that replaces it, for an UPDATE. */
  supersededBy: string | null;
  /** System time of the close. */
  expiredAt: string;
}

interface FactRow {
  id: string;
  subject_kind: string;
  subject_key: string;
  predicate: string;
  object_kind: string | null;
  object_key: string | null;
  text: string;
  topic_id: string | null;
  source: string;
  valid_from: string;
  invalid_at: string | null;
  invalid_reason: string | null;
  superseded_by: string | null;
  recorded_at: string;
  expired_at: string | null;
  stale_at: string | null;
  stale_reason: string | null;
  verified_at: string | null;
}

interface FactRefRow {
  fact_id: string;
  kind: string;
  pr_key: string;
  source_id: string;
  url: string | null;
  at: string;
  head_oid: string | null;
}

const ACTIVE = 'invalid_at IS NULL AND expired_at IS NULL';

/** Newest refs kept per fact next to the oldest, so a fact restated on every update stays bounded. */
const NEWEST_REFS_KEPT = 10;

function toRef(row: FactRefRow): FactRef {
  return {
    kind: row.kind as FactRefKind,
    prKey: row.pr_key,
    sourceId: row.source_id === '' ? null : row.source_id,
    url: row.url,
    at: row.at,
    headOid: row.head_oid,
  };
}

function toObject(row: FactRow): EntityRef | null {
  if (row.object_kind === null || row.object_key === null) {
    return null;
  }
  return { kind: row.object_kind as EntityKind, key: row.object_key };
}

function toFact(row: FactRow, refs: FactRef[]): Fact {
  return {
    id: row.id,
    subject: { kind: row.subject_kind as EntityKind, key: row.subject_key },
    predicate: row.predicate as FactPredicate,
    object: toObject(row),
    text: row.text,
    topicId: row.topic_id,
    source: row.source as FactSource,
    refs,
    validFrom: row.valid_from,
    invalidAt: row.invalid_at,
    invalidReason: row.invalid_reason,
    supersededBy: row.superseded_by,
    recordedAt: row.recorded_at,
    expiredAt: row.expired_at,
    staleAt: row.stale_at,
    staleReason: row.stale_reason as StaleReason | null,
    verifiedAt: row.verified_at,
  };
}

/** Entities per query: 4 params each stays far below SQLite's host parameter limit. */
const ENTITY_CHUNK = 1000;

/**
 * "(subject_kind, subject_key) IN (VALUES (?, ?), ...) OR (object_kind, object_key) IN (VALUES ...)"
 * plus its params. One VALUES list instead of an OR per entity, because SQLite
 * rejects expression trees deeper than 1000.
 */
function entityFilter(entities: EntityRef[]): { sql: string; params: SqlValue[] } {
  const pairs = entities.map(() => '(?, ?)').join(', ');
  const params: SqlValue[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const entity of entities) {
      params.push(entity.kind, entity.key);
    }
  }
  return {
    sql: `((subject_kind, subject_key) IN (VALUES ${pairs}) OR (object_kind, object_key) IN (VALUES ${pairs}))`,
    params,
  };
}

/**
 * Facts and their refs. Nothing is ever deleted: close() ends a fact,
 * markStale() hides it until a refresh. "Active" means invalid_at and
 * expired_at are both null; stale facts are active but flagged.
 */
export class FactRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Refs of these facts, oldest first per fact. */
  private refsFor(factIds: string[]): Map<string, FactRef[]> {
    const result = new Map<string, FactRef[]>(factIds.map((id) => [id, []]));
    if (factIds.length === 0) {
      return result;
    }
    const rows = all<FactRefRow>(
      this.db,
      `SELECT * FROM fact_ref WHERE fact_id IN (${placeholders(factIds.length)}) ORDER BY at, kind, source_id`,
      ...factIds,
    );
    for (const row of rows) {
      result.get(row.fact_id)?.push(toRef(row));
    }
    return result;
  }

  /** Oldest recorded first unless newestFirst. */
  private select(where: string, params: SqlValue[], newestFirst = false, limit = -1): Fact[] {
    const order = newestFirst ? 'recorded_at DESC, id' : 'recorded_at, id';
    const rows = all<FactRow>(
      this.db,
      `SELECT * FROM fact WHERE ${where} ORDER BY ${order} LIMIT ?`,
      ...params,
      limit,
    );
    const refs = this.refsFor(rows.map((row) => row.id));
    return rows.map((row) => toFact(row, refs.get(row.id) ?? []));
  }

  private insertRefs(factId: string, refs: FactRef[]): void {
    for (const ref of refs) {
      run(
        this.db,
        `INSERT OR IGNORE INTO fact_ref (fact_id, kind, pr_key, source_id, url, at, head_oid)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        factId,
        ref.kind,
        ref.prKey,
        ref.sourceId ?? '',
        ref.url,
        ref.at,
        ref.headOid,
      );
    }
  }

  /** Inserts the fact and its refs. */
  add(fact: Fact): void {
    inTransaction(this.db, () => {
      run(
        this.db,
        `INSERT INTO fact
           (id, subject_kind, subject_key, predicate, object_kind, object_key, text, topic_id, source,
            valid_from, invalid_at, invalid_reason, superseded_by, recorded_at, expired_at,
            stale_at, stale_reason, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fact.id,
        fact.subject.kind,
        fact.subject.key,
        fact.predicate,
        fact.object?.kind ?? null,
        fact.object?.key ?? null,
        fact.text,
        fact.topicId,
        fact.source,
        fact.validFrom,
        fact.invalidAt,
        fact.invalidReason,
        fact.supersededBy,
        fact.recordedAt,
        fact.expiredAt,
        fact.staleAt,
        fact.staleReason,
        fact.verifiedAt,
      );
      this.insertRefs(fact.id, fact.refs);
    });
  }

  get(id: string): Fact | null {
    return this.select('id = ?', [id])[0] ?? null;
  }

  getMany(ids: string[]): Map<string, Fact> {
    if (ids.length === 0) {
      return new Map();
    }
    const facts = this.select(`id IN (${placeholders(ids.length)})`, ids);
    return new Map(facts.map((fact) => [fact.id, fact]));
  }

  /** Active facts whose subject or object is one of these entities. */
  listActiveForEntities(entities: EntityRef[]): Fact[] {
    if (entities.length === 0) {
      return [];
    }
    const byId = new Map<string, Fact>();
    for (let start = 0; start < entities.length; start += ENTITY_CHUNK) {
      const filter = entityFilter(entities.slice(start, start + ENTITY_CHUNK));
      for (const fact of this.select(`${ACTIVE} AND ${filter.sql}`, filter.params)) {
        byId.set(fact.id, fact);
      }
    }
    // Same order as select(): oldest recorded first, then id.
    return [...byId.values()].sort((a, b) => {
      if (a.recordedAt !== b.recordedAt) {
        return a.recordedAt < b.recordedAt ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
  }

  /** Active facts a topic's dossier update produced. */
  listActiveForTopic(topicId: string): Fact[] {
    return this.select(`${ACTIVE} AND topic_id = ?`, [topicId]);
  }

  /** Active facts about one of these PRs or citing one in a ref. Used by the verify pass after a fetch. */
  listActiveTouchingPrs(prKeys: PrKey[]): Fact[] {
    if (prKeys.length === 0) {
      return [];
    }
    const list = placeholders(prKeys.length);
    return this.select(
      `${ACTIVE} AND (
         (subject_kind = 'pr' AND subject_key IN (${list}))
         OR (object_kind = 'pr' AND object_key IN (${list}))
         OR id IN (SELECT fact_id FROM fact_ref WHERE pr_key IN (${list}))
       )`,
      [...prKeys, ...prKeys, ...prKeys],
    );
  }

  /**
   * The recheck list for a topic's next dossier update: active stale facts not
   * offered since they went stale, newest stale first, at most limit.
   */
  listStaleToRecheck(topicId: string, limit: number): Fact[] {
    const rows = all<{ id: string }>(
      this.db,
      `SELECT id FROM fact
       WHERE ${ACTIVE} AND topic_id = ? AND stale_at IS NOT NULL
         AND (rechecked_at IS NULL OR rechecked_at < stale_at)
       ORDER BY stale_at DESC, id LIMIT ?`,
      topicId,
      limit,
    );
    const facts = this.getMany(rows.map((row) => row.id));
    return rows.map((row) => facts.get(row.id)).filter((fact): fact is Fact => fact !== undefined);
  }

  /** These facts were handed to a dossier update; they are not offered again until they go stale anew. */
  markRechecked(factIds: string[], at: string): void {
    if (factIds.length === 0) {
      return;
    }
    run(this.db, `UPDATE fact SET rechecked_at = ? WHERE id IN (${placeholders(factIds.length)})`, at, ...factIds);
  }

  /**
   * Moves the head a fact's refs were pinned to, after a recheck confirmed
   * the fact at the PR's current head. Refs without a head stay without one.
   */
  reanchorRefs(factId: string, headByPr: Map<PrKey, string>): void {
    for (const [prKey, headOid] of headByPr) {
      run(
        this.db,
        'UPDATE fact_ref SET head_oid = ? WHERE fact_id = ? AND pr_key = ? AND head_oid IS NOT NULL',
        headOid,
        factId,
        prKey,
      );
    }
  }

  /**
   * Filtered listing for EngineService.listFacts, newest recorded first.
   * changedSince also returns facts closed after that time, so it implies includeClosed.
   */
  query(query: FactQuery): Fact[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    if (query.entity !== undefined) {
      const filter = entityFilter([query.entity]);
      conditions.push(filter.sql);
      params.push(...filter.params);
    }
    if (query.predicate !== undefined) {
      conditions.push('predicate = ?');
      params.push(query.predicate);
    }
    if (query.topicId !== undefined) {
      conditions.push('topic_id = ?');
      params.push(query.topicId);
    }
    if (query.changedSince !== undefined) {
      conditions.push('(recorded_at > ? OR expired_at > ?)');
      params.push(query.changedSince, query.changedSince);
    } else if (!query.includeClosed) {
      conditions.push(ACTIVE);
    }
    const where = conditions.length === 0 ? '1 = 1' : conditions.join(' AND ');
    return this.select(where, params, true, query.limit ?? 100);
  }

  /**
   * Adds refs to an existing fact, ignoring ones it already has (NOOP
   * reconcile), and sets verified_at. Keeps the oldest ref (where the fact
   * came from) and the newest NEWEST_REFS_KEPT.
   */
  addRefs(factId: string, refs: FactRef[], at: string): void {
    inTransaction(this.db, () => {
      this.insertRefs(factId, refs);
      run(
        this.db,
        `DELETE FROM fact_ref WHERE fact_id = ?
           AND rowid NOT IN (SELECT rowid FROM fact_ref WHERE fact_id = ? ORDER BY at, rowid LIMIT 1)
           AND rowid NOT IN (SELECT rowid FROM fact_ref WHERE fact_id = ? ORDER BY at DESC, rowid DESC LIMIT ?)`,
        factId,
        factId,
        factId,
        NEWEST_REFS_KEPT,
      );
      run(this.db, 'UPDATE fact SET verified_at = ? WHERE id = ?', at, factId);
    });
  }

  /** Ends a fact. Closing an already closed fact is a no-op. */
  close(factId: string, closing: FactClosing): void {
    run(
      this.db,
      `UPDATE fact SET invalid_at = ?, invalid_reason = ?, superseded_by = ?, expired_at = ?
       WHERE id = ? AND ${ACTIVE}`,
      closing.invalidAt,
      closing.reason,
      closing.supersededBy,
      closing.expiredAt,
      factId,
    );
  }

  /** Undoes close(): only for taking back a user's correction inside its undo window. */
  reopen(factId: string): void {
    run(this.db, 'UPDATE fact SET invalid_at = NULL, invalid_reason = NULL, superseded_by = NULL, expired_at = NULL WHERE id = ?', factId);
  }

  /** Puts stale_* and verified_at back as they were, to undo a confirm. */
  restoreCheck(fact: Pick<Fact, 'id' | 'staleAt' | 'staleReason' | 'verifiedAt'>): void {
    run(
      this.db,
      'UPDATE fact SET stale_at = ?, stale_reason = ?, verified_at = ? WHERE id = ?',
      fact.staleAt,
      fact.staleReason,
      fact.verifiedAt,
      fact.id,
    );
  }

  /** Keeps the first stale time and reason while the fact stays stale. */
  markStale(factId: string, reason: StaleReason, at: string): void {
    run(
      this.db,
      'UPDATE fact SET stale_at = ?, stale_reason = ? WHERE id = ? AND stale_at IS NULL',
      at,
      reason,
      factId,
    );
  }

  /** Clears stale_* and sets verified_at. */
  markVerified(factIds: string[], at: string): void {
    if (factIds.length === 0) {
      return;
    }
    run(
      this.db,
      `UPDATE fact SET stale_at = NULL, stale_reason = NULL, verified_at = ?
       WHERE id IN (${placeholders(factIds.length)})`,
      at,
      ...factIds,
    );
  }
}
