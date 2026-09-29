import type {
  AgentCallCount,
  AgentCallKind,
  AgentCallStats,
  ConsolidationReport,
  FactChangeCounts,
} from '@postpile/core';

/** The order a sync spends its budget in, then the rest. */
const KIND_ORDER: AgentCallKind[] = [
  'topic_assignment',
  'dossier_update',
  'fact_reconcile',
  'set_grouping',
  'glance_batch',
  'event_classification',
  'consolidation',
  'draft_comment',
  'chat',
  'instructions_change',
  'memory_recheck',
];

function countNotes(count: AgentCallCount): string {
  const notes: string[] = [];
  if (count.failed > 0) {
    notes.push(`${count.failed} failed`);
  }
  if (count.retries > 0) {
    notes.push(count.retries === 1 ? '1 retry' : `${count.retries} retries`);
  }
  if (count.skippedUnchanged > 0) {
    notes.push(`${count.skippedUnchanged} skipped unchanged`);
  }
  if (count.skippedByBudget > 0) {
    notes.push(`${count.skippedByBudget} skipped by budget`);
  }
  return notes.length > 0 ? ` (${notes.join(', ')})` : '';
}

/** "dossier_update 3 (1 skipped unchanged)  glance_batch 4 (1 retry)  total 7, $0.12" */
export function formatCallStats(stats: AgentCallStats): string {
  const parts: string[] = [];
  let cost: number | null = null;
  for (const kind of KIND_ORDER) {
    const count = stats.byKind[kind];
    if (!count) {
      continue;
    }
    parts.push(`${kind} ${count.calls}${countNotes(count)}`);
    if (count.costUsd !== null) {
      cost = (cost ?? 0) + count.costUsd;
    }
  }
  const total = cost === null ? `total ${stats.total}` : `total ${stats.total}, $${cost.toFixed(2)}`;
  return [...parts, total].join('  ');
}

export function formatFactCounts(counts: FactChangeCounts): string {
  const { added, updated, invalidated, confirmed, stale } = counts;
  return `facts: ${added} added, ${updated} updated, ${invalidated} closed, ${confirmed} confirmed, ${stale} stale`;
}

export function formatConsolidation(report: ConsolidationReport): string {
  if (report.skipped === 'not_due') {
    return 'consolidation not due (24h since the last run and a new dossier version needed)';
  }
  if (report.skipped === 'agent_off') {
    return 'consolidation skipped: agent features are off (claude missing, logged out or at its usage limit)';
  }
  const lines = [
    `topic proposals ${report.topicProposalsFiled}, rule proposals ${report.ruleProposalsFiled}, facts merged ${report.factsMerged}, topics retired ${report.topicsRetired}, small splits applied ${report.topicsSplit}`,
    `agent: ${formatCallStats(report.agentCallStats)}`,
  ];
  for (const error of report.errors) {
    lines.push(`error: ${error}`);
  }
  return lines.join('\n');
}
