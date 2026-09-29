import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, ProposalSource, ProposalStatus, TopicProposal, TopicProposalKind } from '@postpile/core';
import { all, one, run } from '../sql.ts';

interface ProposalRow {
  id: string;
  kind: string;
  topic_id: string | null;
  name: string | null;
  into_topic_id: string | null;
  from_area: string | null;
  pr_keys_json: string;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  source: string;
  client: string | null;
}

function toProposal(row: ProposalRow): TopicProposal {
  return {
    id: row.id,
    kind: row.kind as TopicProposalKind,
    topicId: row.topic_id,
    name: row.name,
    intoTopicId: row.into_topic_id,
    fromArea: row.from_area,
    prKeys: JSON.parse(row.pr_keys_json) as PrKey[],
    reason: row.reason,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    source: row.source as ProposalSource,
    client: row.client,
  };
}

export class TopicProposalRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(proposal: TopicProposal): void {
    run(
      this.db,
      `INSERT INTO topic_proposal
         (id, kind, topic_id, name, into_topic_id, from_area, pr_keys_json, reason, status, created_at, decided_at, source, client)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      proposal.id,
      proposal.kind,
      proposal.topicId,
      proposal.name,
      proposal.intoTopicId,
      proposal.fromArea,
      JSON.stringify(proposal.prKeys),
      proposal.reason,
      proposal.status,
      proposal.createdAt,
      proposal.decidedAt,
      proposal.source,
      proposal.client,
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

  /** Proposals about this topic decided (accepted or rejected) at or after `since`, newest first. */
  listDecidedForTopic(topicId: string, since: string): TopicProposal[] {
    return all<ProposalRow>(
      this.db,
      `SELECT * FROM topic_proposal
       WHERE topic_id = ? AND status != 'pending' AND decided_at >= ?
       ORDER BY decided_at DESC, id`,
      topicId,
      since,
    ).map(toProposal);
  }

  /** Every pending proposal from an outside agent, expired or not, oldest first. */
  listPendingFromAgents(): TopicProposal[] {
    return all<ProposalRow>(
      this.db,
      "SELECT * FROM topic_proposal WHERE status = 'pending' AND source = 'agent' ORDER BY created_at, id",
    ).map(toProposal);
  }

  /** How many proposals outside agents filed at or after `since`, whatever became of them. */
  countFromAgentsSince(since: string): number {
    return one<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM topic_proposal WHERE source = 'agent' AND created_at >= ?", since)?.n ?? 0;
  }

  /** Every area_merge proposal, any status, oldest first. They name no topic. */
  listAreaMerges(): TopicProposal[] {
    return all<ProposalRow>(this.db, "SELECT * FROM topic_proposal WHERE kind = 'area_merge' ORDER BY created_at, id").map(toProposal);
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
