import type {
  AgentCallCount,
  AgentCallKind,
  AgentCallStats,
  ConsolidationReport,
  DossierIssue,
  DossierView,
  FactChangeCounts,
  FactView,
  TopicChanges,
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

function day(iso: string): string {
  return iso.slice(0, 10);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

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
  const lines = [
    `topic proposals ${report.topicProposalsFiled}, rule proposals ${report.ruleProposalsFiled}, facts merged ${report.factsMerged}, topics retired ${report.topicsRetired}`,
    `agent: ${formatCallStats(report.agentCallStats)}`,
  ];
  for (const error of report.errors) {
    lines.push(`error: ${error}`);
  }
  return lines.join('\n');
}

function staleMark(issues: DossierIssue[], path: string): string {
  const issue = issues.find((i) => i.path === path);
  return issue ? `  [stale: ${issue.reason}]` : '';
}

function formatChanges(changes: TopicChanges): string[] {
  const lines = [`since you last looked (${day(changes.since)}): ${plural(changes.newEvents, 'new event')}`];
  for (const change of changes.changes) {
    lines.push(`  - ${day(change.at)} ${change.text}`);
  }
  for (const fact of changes.factsAdded) {
    lines.push(`  + ${fact.text}`);
  }
  for (const fact of changes.factsClosed) {
    lines.push(`  x ${fact.text}${fact.invalidReason ? ` (${fact.invalidReason})` : ''}`);
  }
  return lines;
}

/** The dossier as plain text. PR state is not in the dossier; the tiles below show it. */
export function formatDossier(view: DossierView): string[] {
  const { dossier, staleClaims } = view;
  const behind = view.eventsBehind > 0 ? `, ${plural(view.eventsBehind, 'event')} not read yet` : '';
  const lines = [`dossier v${view.version} (${day(view.createdAt)}${behind})`];
  lines.push(`status: ${dossier.status}${dossier.statusNote ? ` - ${dossier.statusNote}` : ''}`);
  if (dossier.goal) {
    lines.push(`goal: ${dossier.goal}`);
  }
  if (dossier.people.length > 0) {
    lines.push(`people: ${dossier.people.map((p) => `@${p.login} ${p.role}${p.note ? ` (${p.note})` : ''}`).join(', ')}`);
  }
  for (const care of dossier.userCares) {
    lines.push(`you care: ${care.text} (${care.source})`);
  }
  dossier.openQuestions.forEach((question, i) => {
    const askedBy = question.askedBy ? ` (asked by @${question.askedBy})` : '';
    lines.push(`? ${question.text}${askedBy}${staleMark(staleClaims, `openQuestions[${i}]`)}`);
  });
  if (dossier.timeline.length > 0) {
    lines.push('timeline:');
    dossier.timeline.forEach((entry, i) => {
      lines.push(`  ${entry.prKey}: ${entry.role}${staleMark(staleClaims, `timeline[${i}]`)}`);
    });
  }
  if (dossier.earlier) {
    lines.push(`earlier: ${dossier.earlier}`);
  }
  if (dossier.recentChanges.length > 0) {
    lines.push('recent changes:');
    for (const change of dossier.recentChanges) {
      lines.push(`  ${day(change.at)} ${change.text}`);
    }
  }
  for (const flag of view.flags) {
    lines.push(`! ${flag.kind}: ${flag.text}${flag.prKey ? ` (${flag.prKey})` : ''}`);
  }
  if (view.changesSinceSeen) {
    lines.push(...formatChanges(view.changesSinceSeen));
  }
  return lines;
}

export function formatFacts(views: FactView[]): string[] {
  if (views.length === 0) {
    return [];
  }
  const lines = ['facts:'];
  for (const { fact, stale } of views) {
    const since = `since ${day(fact.validFrom)}`;
    lines.push(`  ${fact.text}  (${fact.predicate}, ${since}${stale ? `, stale: ${stale}` : ''})`);
  }
  return lines;
}
