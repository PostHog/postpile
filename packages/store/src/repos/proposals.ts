import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, ProposalStatus, TopicProposal, TopicProposalKind } from '@code-manager/core';
import { all, one, run } from '../sql.ts';

interface ProposalRow {
  id: string;
  kind: string;
  topic_id: string | null;
  name: string | null;
  into_topic_id: string | null;
  pr_keys_json: string;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

function toProposal(row: ProposalRow): TopicProposal {
  return {
    id: row.id,
    kind: row.kind as TopicProposalKind,
    topicId: row.topic_id,
    name: row.name,
    intoTopicId: row.into_topic_id,
    prKeys: JSON.parse(row.pr_keys_json) as PrKey[],
    reason: row.reason,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class TopicProposalRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(proposal: TopicProposal): void {
    run(
      this.db,
      `INSERT INTO topic_proposal
         (id, kind, topic_id, name, into_topic_id, pr_keys_json, reason, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      proposal.id,
      proposal.kind,
      proposal.topicId,
      proposal.name,
      proposal.intoTopicId,
      JSON.stringify(proposal.prKeys),
      proposal.reason,
      proposal.status,
      proposal.createdAt,
      proposal.decidedAt,
    );
  }

  get(id: string): TopicProposal | null {
    const row = one<ProposalRow>(this.db, 'SELECT * FROM topic_proposal WHERE id = ?', id);
    return row ? toProposal(row) : null;
  }

  /** Oldest first. */
  listPending(): TopicProposal[] {
    return all<ProposalRow>(
      this.db,
      "SELECT * FROM topic_proposal WHERE status = 'pending' ORDER BY created_at, id",
    ).map(toProposal);
  }

  /** Pending proposals that touch a topic, as the changed topic or the merge target. */
  listPendingForTopic(topicId: string): TopicProposal[] {
    return all<ProposalRow>(
      this.db,
      `SELECT * FROM topic_proposal
       WHERE status = 'pending' AND (topic_id = ? OR into_topic_id = ?)
       ORDER BY created_at, id`,
      topicId,
      topicId,
    ).map(toProposal);
  }

  /** Every proposal about changing this topic, any status, oldest first. */
  listForTopic(topicId: string): TopicProposal[] {
    return all<ProposalRow>(
      this.db,
      'SELECT * FROM topic_proposal WHERE topic_id = ? ORDER BY created_at, id',
      topicId,
    ).map(toProposal);
  }

  /** Deciding twice is a no-op: only pending proposals change. */
  decide(id: string, status: Exclude<ProposalStatus, 'pending'>, at: string): void {
    run(
      this.db,
      "UPDATE topic_proposal SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      status,
      at,
      id,
    );
  }
}
