import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, TopicMembership } from '@code-manager/core';

export class TopicMembershipRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Insert or replace. A user assignment must never be replaced by an agent one; callers check. */
  assign(_membership: TopicMembership): void {
    throw new Error('not implemented');
  }

  get(_prKey: PrKey): TopicMembership | null {
    throw new Error('not implemented');
  }

  listForTopic(_topicId: string): TopicMembership[] {
    throw new Error('not implemented');
  }

  /** PR keys that have a stored PR but no topic yet. */
  listUnassignedPrKeys(): PrKey[] {
    throw new Error('not implemented');
  }
}
