import type { DatabaseSync } from 'node:sqlite';
import type { EntityRef, Fact, FactQuery, FactRef, PrKey, StaleReason } from '@code-manager/core';

export interface FactClosing {
  /** World time the fact stopped being true. */
  invalidAt: string;
  reason: string;
  /** The fact that replaces it, for an UPDATE. */
  supersededBy: string | null;
  /** System time of the close. */
  expiredAt: string;
}

/**
 * Facts and their refs. Nothing is ever deleted: close() ends a fact,
 * markStale() hides it until a refresh. "Active" means invalid_at and
 * expired_at are both null; stale facts are active but flagged.
 */
export class FactRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Inserts the fact and its refs. */
  add(fact: Fact): void {
    throw new Error('not implemented: FactRepo.add');
  }

  get(id: string): Fact | null {
    throw new Error('not implemented: FactRepo.get');
  }

  getMany(ids: string[]): Map<string, Fact> {
    throw new Error('not implemented: FactRepo.getMany');
  }

  /** Active facts whose subject or object is one of these entities. */
  listActiveForEntities(entities: EntityRef[]): Fact[] {
    throw new Error('not implemented: FactRepo.listActiveForEntities');
  }

  /** Active facts a topic's dossier update produced. */
  listActiveForTopic(topicId: string): Fact[] {
    throw new Error('not implemented: FactRepo.listActiveForTopic');
  }

  /** Active facts about one of these PRs or citing one in a ref. Used by the verify pass after a fetch. */
  listActiveTouchingPrs(prKeys: PrKey[]): Fact[] {
    throw new Error('not implemented: FactRepo.listActiveTouchingPrs');
  }

  /** Active stale facts of a topic: the recheck list for its next dossier update. */
  listStaleForTopic(topicId: string): Fact[] {
    throw new Error('not implemented: FactRepo.listStaleForTopic');
  }

  /** Filtered listing for EngineService.listFacts, newest recorded first. */
  query(query: FactQuery): Fact[] {
    throw new Error('not implemented: FactRepo.query');
  }

  /** Adds refs to an existing fact, ignoring ones it already has (NOOP reconcile). Also sets verified_at. */
  addRefs(factId: string, refs: FactRef[], at: string): void {
    throw new Error('not implemented: FactRepo.addRefs');
  }

  /** Ends a fact. Closing an already closed fact is a no-op. */
  close(factId: string, closing: FactClosing): void {
    throw new Error('not implemented: FactRepo.close');
  }

  markStale(factId: string, reason: StaleReason, at: string): void {
    throw new Error('not implemented: FactRepo.markStale');
  }

  /** Clears stale_* and sets verified_at. */
  markVerified(factIds: string[], at: string): void {
    throw new Error('not implemented: FactRepo.markVerified');
  }
}
