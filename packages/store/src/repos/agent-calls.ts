import type { DatabaseSync } from 'node:sqlite';
import {
  emptyAgentCallStats,
  recordAgentCall,
  type AgentCallKind,
  type AgentCallRecord,
  type AgentCallStats,
} from '@code-manager/core';
import { all, fromBool, one, run, toBool } from '../sql.ts';

interface AgentCallRow {
  kind: string;
  ok: number;
  attempt: number;
  duration_ms: number;
  cost_usd: number | null;
}

/** One row per runner call. Append-only. */
export class AgentCallRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(record: AgentCallRecord): void {
    run(
      this.db,
      `INSERT INTO agent_call (run_id, kind, topic_id, model, ok, attempt, duration_ms, cost_usd, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.runId,
      record.kind,
      record.topicId,
      record.model,
      fromBool(record.ok),
      record.attempt,
      Math.round(record.durationMs),
      record.costUsd,
      record.at,
    );
  }

  /** Stats of one run (a sync or a consolidation), built from its rows. Skips are not stored, so they read 0. */
  statsForRun(runId: string): AgentCallStats {
    const stats = emptyAgentCallStats();
    const rows = all<AgentCallRow>(
      this.db,
      'SELECT kind, ok, attempt, duration_ms, cost_usd FROM agent_call WHERE run_id = ? ORDER BY id',
      runId,
    );
    for (const row of rows) {
      recordAgentCall(stats, {
        kind: row.kind as AgentCallKind,
        outcome: toBool(row.ok) ? 'ok' : 'failed',
        attempt: row.attempt,
        durationMs: row.duration_ms,
        costUsd: row.cost_usd,
      });
    }
    return stats;
  }

  /** Calls of this kind at or after `since`, failed ones included. Caps user-asked calls like memory rechecks. */
  countSince(kind: AgentCallKind, since: string): number {
    const row = one<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM agent_call WHERE kind = ? AND at >= ?', kind, since);
    return row?.count ?? 0;
  }

  /** Time of the newest successful call of this kind, or null. Consolidation uses it to decide when it is due. */
  lastOkAt(kind: AgentCallKind): string | null {
    const row = one<{ at: string | null }>(this.db, 'SELECT MAX(at) AS at FROM agent_call WHERE kind = ? AND ok = 1', kind);
    return row?.at ?? null;
  }
}
