import type { DatabaseSync } from 'node:sqlite';
import type { ProposalStatus, RuleProposal } from '@code-manager/core';

/** Standing rules the consolidation job proposes. They only apply once accepted. */
export class RuleProposalRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(proposal: RuleProposal): void {
    throw new Error('not implemented: RuleProposalRepo.add');
  }

  get(id: string): RuleProposal | null {
    throw new Error('not implemented: RuleProposalRepo.get');
  }

  /** Oldest first. */
  listPending(): RuleProposal[] {
    throw new Error('not implemented: RuleProposalRepo.listPending');
  }

  /** Accepted and rejected, newest first. Goes into the consolidation prompt so ideas are not proposed twice. */
  listDecided(limit: number): RuleProposal[] {
    throw new Error('not implemented: RuleProposalRepo.listDecided');
  }

  /** Accepted global rules (topic_id null), oldest first. Every prompt carries these. */
  listAcceptedGlobal(): RuleProposal[] {
    throw new Error('not implemented: RuleProposalRepo.listAcceptedGlobal');
  }

  decide(id: string, status: Exclude<ProposalStatus, 'pending'>, at: string): void {
    throw new Error('not implemented: RuleProposalRepo.decide');
  }
}
