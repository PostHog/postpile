import type { DatabaseSync } from 'node:sqlite';
import type { PingDecision, PingDecisionSource } from '@code-manager/core';
import { all, fromBool, run, toBool } from '../sql.ts';

interface PingDecisionRow {
  thread_id: string;
  pr_key: string;
  ping: number;
  source: string;
  title: string;
  body: string;
  reason: string;
  at: string;
}

function toDecision(row: PingDecisionRow): PingDecision {
  return {
    threadId: row.thread_id,
    prKey: row.pr_key,
    ping: toBool(row.ping),
    source: row.source as PingDecisionSource,
    title: row.title,
    body: row.body,
    reason: row.reason,
    at: row.at,
  };
}

/** Append-only log of ping decisions, for debugging. */
export class PingDecisionRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(decision: PingDecision): void {
    run(
      this.db,
      `INSERT INTO ping_decision (thread_id, pr_key, ping, source, title, body, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      decision.threadId,
      decision.prKey,
      fromBool(decision.ping),
      decision.source,
      decision.title,
      decision.body,
      decision.reason,
      decision.at,
    );
  }

  /** Newest first. */
  listRecent(limit: number): PingDecision[] {
    return all<PingDecisionRow>(this.db, 'SELECT * FROM ping_decision ORDER BY id DESC LIMIT ?', limit).map(toDecision);
  }
}
