import type { ConsolidateOptions, ConsolidationReport } from '@postpile/core';

/** How often the app asks whether consolidation is due. */
export const CONSOLIDATION_CHECK_MS = 30 * 60 * 1000;

type Consolidate = (options: ConsolidateOptions) => Promise<ConsolidationReport>;

function reportLine(report: ConsolidationReport): string {
  const errors = report.errors.length > 0 ? `, errors: ${report.errors.join('; ')}` : '';
  return (
    `consolidation: ${report.topicProposalsFiled} topic and ${report.ruleProposalsFiled} rule proposals, ` +
    `${report.factsMerged} facts merged, ${report.topicsRetired} topics retired, ${report.agentCallStats.total} agent calls${errors}`
  );
}

/**
 * The sleep-time job, run by the desktop app. Every 30 minutes it asks the
 * engine to consolidate with onlyIfDue: the engine decides whether it is due
 * (24h since the last run and a new dossier version since) and waits for a
 * running sync or poll first, so they never overlap. A run is logged, a
 * failure too; nothing is thrown.
 */
export class ConsolidationSchedule {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly consolidate: Consolidate,
    private readonly maxAgentCalls: number,
    private readonly log: (line: string) => void = console.log,
  ) {}

  async runIfDue(): Promise<void> {
    try {
      const report = await this.consolidate({ onlyIfDue: true, maxAgentCalls: this.maxAgentCalls });
      if (report.skipped === null) {
        this.log(reportLine(report));
      }
    } catch (error) {
      this.log(`consolidation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  start(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => void this.runIfDue(), CONSOLIDATION_CHECK_MS);
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
