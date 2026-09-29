import type { ConsolidateOptions, ConsolidationReport } from '@postpile/core';
import { AgentBudget } from '../budget.ts';
import { errorText } from '../errors.ts';
import type { RunDeps } from '../run-deps.ts';
import { runTelemetry } from '../run-deps.ts';
import { Consolidator } from './consolidator.ts';

function emptyReport(startedAt: string): ConsolidationReport {
  return {
    startedAt,
    finishedAt: startedAt,
    skipped: null,
    topicProposalsFiled: 0,
    ruleProposalsFiled: 0,
    factsMerged: 0,
    topicsRetired: 0,
    agentCallStats: { total: 0, byKind: {} },
    errors: [],
  };
}

/** One consolidation run with its own call stats and budget. */
export class ConsolidationRun {
  constructor(private readonly deps: RunDeps) {}

  async run(options: ConsolidateOptions): Promise<ConsolidationReport> {
    const { now, callLog } = this.deps;
    const startedAt = now().toISOString();
    const report = emptyReport(startedAt);
    // Consolidation is agent work only.
    if (this.deps.agentOff() !== null) {
      report.skipped = 'agent_off';
      return report;
    }
    report.agentCallStats = callLog.begin(`consolidate:${startedAt}`);
    try {
      const consolidator = new Consolidator({
        store: this.deps.store,
        agent: this.deps.agent,
        contexts: this.deps.contexts,
        budget: new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY, report.agentCallStats),
        facts: this.deps.facts,
        errors: report.errors,
        now,
      });
      await consolidator.run(options, report);
    } catch (error) {
      report.errors.push(`consolidation: ${errorText(error)}`);
    } finally {
      callLog.end();
    }
    report.finishedAt = now().toISOString();
    if (report.skipped === null) {
      runTelemetry(this.deps).capture('consolidation_ran', { proposals_filed: report.topicProposalsFiled + report.ruleProposalsFiled });
    }
    return report;
  }
}
