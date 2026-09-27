import type { DatabaseSync } from 'node:sqlite';
import type { AgentCallKind, AgentCallRecord, AgentCallStats } from '@code-manager/core';

/** One row per runner call. Append-only. */
export class AgentCallRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(record: AgentCallRecord): void {
    throw new Error('not implemented: AgentCallRepo.add');
  }

  /** Stats of one run (a sync or a consolidation), built from its rows. Skips are not stored, so they read 0. */
  statsForRun(runId: string): AgentCallStats {
    throw new Error('not implemented: AgentCallRepo.statsForRun');
  }

  /** Time of the newest successful call of this kind, or null. Consolidation uses it to decide when it is due. */
  lastOkAt(kind: AgentCallKind): string | null {
    throw new Error('not implemented: AgentCallRepo.lastOkAt');
  }
}
