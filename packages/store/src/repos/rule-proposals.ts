import type { DatabaseSync } from 'node:sqlite';
import type { ProposalStatus, RuleProposal } from '@postpile/core';
import { all, one, run } from '../sql.ts';

interface RuleProposalRow {
  id: string;
  text: string;
  topic_id: string | null;
  evidence_json: string;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

function toProposal(row: RuleProposalRow): RuleProposal {
  return {
    id: row.id,
    text: row.text,
    topicId: row.topic_id,
    evidenceFeedbackIds: JSON.parse(row.evidence_json) as number[],
    reason: row.reason,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/** Standing rules the consolidation job proposes. They only apply once accepted. */
export class RuleProposalRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(proposal: RuleProposal): void {
    run(
      this.db,
      `INSERT INTO rule_proposal (id, text, topic_id, evidence_json, reason, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      proposal.id,
      proposal.text,
      proposal.topicId,
      JSON.stringify(proposal.evidenceFeedbackIds),
      proposal.reason,
      proposal.status,
      proposal.createdAt,
      proposal.decidedAt,
    );
  }

  get(id: string): RuleProposal | null {
    const row = one<RuleProposalRow>(this.db, 'SELECT * FROM rule_proposal WHERE id = ?', id);
    return row ? toProposal(row) : null;
  }

  /** Oldest first. */
  listPending(): RuleProposal[] {
    return all<RuleProposalRow>(
      this.db,
      "SELECT * FROM rule_proposal WHERE status = 'pending' ORDER BY created_at, id",
    ).map(toProposal);
  }

  /** Accepted and rejected, newest first. Goes into the consolidation prompt so ideas are not proposed twice. */
  listDecided(limit: number): RuleProposal[] {
    return all<RuleProposalRow>(
      this.db,
      "SELECT * FROM rule_proposal WHERE status != 'pending' ORDER BY decided_at DESC, id LIMIT ?",
      limit,
    ).map(toProposal);
  }

  /** Accepted global rules (topic_id null), oldest first. Every prompt carries these. */
  listAcceptedGlobal(): RuleProposal[] {
    return all<RuleProposalRow>(
      this.db,
      "SELECT * FROM rule_proposal WHERE status = 'accepted' AND topic_id IS NULL ORDER BY decided_at, id",
    ).map(toProposal);
  }

  /** Deciding twice is a no-op: only pending proposals change. */
  decide(id: string, status: Exclude<ProposalStatus, 'pending'>, at: string): void {
    run(
      this.db,
      "UPDATE rule_proposal SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      status,
      at,
      id,
    );
  }
}
