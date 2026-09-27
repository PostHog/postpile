import type { DatabaseSync } from 'node:sqlite';
import type { ProposalStatus, TopicProposal } from '@code-manager/core';

export class TopicProposalRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(_proposal: TopicProposal): void {
    throw new Error('not implemented');
  }

  get(_id: string): TopicProposal | null {
    throw new Error('not implemented');
  }

  listPending(): TopicProposal[] {
    throw new Error('not implemented');
  }

  decide(_id: string, _status: Exclude<ProposalStatus, 'pending'>, _at: string): void {
    throw new Error('not implemented');
  }
}
