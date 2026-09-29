import type { DatabaseSync } from 'node:sqlite';
import type { PingDecision, PingDecisionSource } from '@postpile/core';
import { all, fromBool, placeholders, run, toBool } from '../sql.ts';

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

/** Decisions after a point in time, counted by outcome and who decided. */
export interface PingDecisionCounts {
  /** Pings from the poll: rules, agent or fallback. */
  pinged: number;
  withheldRules: number;
  withheldAgent: number;
  /** Pings from a Look closer glance on a routed review (source `glance`). */
  glance: number;
}

/** Append-only log of ping decisions, for debugging and the hourly telemetry summary. */
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

  /** Every decision for these threads, newest first. */
  listForThreads(threadIds: string[]): PingDecision[] {
    if (threadIds.length === 0) {
      return [];
    }
    return all<PingDecisionRow>(
      this.db,
      `SELECT * FROM ping_decision WHERE thread_id IN (${placeholders(threadIds.length)}) ORDER BY id DESC`,
      ...threadIds,
    ).map(toDecision);
  }

  /**
   * Decisions with `since < at <= until` (ISO times). A fallback always
   * pings, so withheld only comes from the rules or the agent.
   */
  countBetween(since: string, until: string): PingDecisionCounts {
    const rows = all<{ ping: number; source: string; n: number }>(
      this.db,
      'SELECT ping, source, COUNT(*) AS n FROM ping_decision WHERE at > ? AND at <= ? GROUP BY ping, source',
      since,
      until,
    );
    const counts: PingDecisionCounts = { pinged: 0, withheldRules: 0, withheldAgent: 0, glance: 0 };
    for (const row of rows) {
      if (row.source === 'glance') {
        counts.glance += row.n;
      } else if (toBool(row.ping)) {
        counts.pinged += row.n;
      } else if (row.source === 'agent') {
        counts.withheldAgent += row.n;
      } else {
        counts.withheldRules += row.n;
      }
    }
    return counts;
  }
}
