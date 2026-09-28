import type { PrDetail, SyncReport, TopicDetail, TopicListItem } from '@postpile/core';
import type { PollCycle } from '@postpile/engine';
import { formatCallStats, formatDossier, formatFactCounts, formatFacts } from './format-memory.ts';

export function formatSync(report: SyncReport): string {
  if (report.blockedBy) {
    return `sync skipped: ${report.blockedBy} (pnpm cli tools shows the fix)`;
  }
  const lines = [
    `threads ${report.threads}, PRs fetched ${report.prsFetched}, new events ${report.newEvents}, dossiers updated ${report.dossiersUpdated}`,
    `agent: ${formatCallStats(report.agentCallStats)}`,
    formatFactCounts(report.facts),
  ];
  if (report.prsFound > 0) {
    lines.push(`${report.prsFound} PRs found outside the inbox (own open, review requests, recent merges)`);
  }
  if (report.prsPulledIn > 0) {
    lines.push(`${report.prsPulledIn} stack layers pulled in (no agent calls)`);
  }
  if (report.prsSkipped > 0) {
    lines.push(`${report.prsSkipped} PRs left for the next sync (--limit)`);
  }
  if (report.notificationsNotModified) {
    lines.push('notifications unchanged (304)');
  }
  if (report.agentOff) {
    lines.push(`rules only: ${report.agentOff}`);
  }
  for (const error of report.errors) {
    lines.push(`error: ${error}`);
  }
  return lines.join('\n');
}

export function formatPoll(cycle: PollCycle): string {
  if (cycle.kind === 'blocked') {
    return `poll blocked: ${cycle.reason}`;
  }
  const interval = cycle.githubPollIntervalSeconds === null ? 'none' : `${cycle.githubPollIntervalSeconds}s`;
  const lines = [
    cycle.notModified ? 'notifications unchanged (304)' : `PRs updated ${cycle.prsUpdated}`,
    `GitHub X-Poll-Interval: ${interval}`,
  ];
  for (const decision of cycle.decisions) {
    const verdict = decision.ping ? 'PING' : 'no ping';
    const text = decision.ping ? `  "${decision.title}"` : '';
    lines.push(`${verdict} ${decision.prKey} (${decision.source}): ${decision.reason}${text}`);
  }
  for (const error of cycle.errors) {
    lines.push(`error: ${error}`);
  }
  return lines.join('\n');
}

export function formatTopics(items: TopicListItem[]): string {
  if (items.length === 0) {
    return 'no topics yet, run sync';
  }
  return items
    .map((item) => `${item.group === 'needs_you' ? '*' : ' '} ${item.topic.id}  ${item.topic.name}  (${item.unreadTiles} unread / ${item.totalTiles})`)
    .join('\n');
}

export function formatTopic(detail: TopicDetail): string {
  const { topic } = detail;
  const lines = [`${topic.name}  (driver ${topic.driver ?? 'unknown'}, you: ${topic.userRole})`, topic.summary];
  if (topic.tailoring) {
    lines.push(`tailoring: ${topic.tailoring}`);
  }
  if (detail.dossier) {
    lines.push('', ...formatDossier(detail.dossier));
  }
  for (const proposal of detail.pendingProposals) {
    lines.push(`proposal ${proposal.id}: ${proposal.kind} ${proposal.name ?? ''} (${proposal.reason})`);
  }
  lines.push('');
  for (const view of detail.tiles) {
    lines.push(`[${view.state.kind}] ${view.tile.kind}: ${view.tile.title}`);
    for (const reason of view.state.unreadBecause) {
      lines.push(`    ! ${reason.prKey}: ${reason.summary}`);
    }
    for (const pr of view.prs) {
      const verdict = pr.verdict ? `${pr.verdict}${pr.glanceStale ? ', stale' : ''}` : 'no glance';
      lines.push(`    ${pr.key}  ${pr.title}  (${pr.provenance.kind}, ${verdict})`);
    }
  }
  return lines.join('\n');
}

export function formatPr(detail: PrDetail): string {
  const { pr } = detail;
  const lines = [
    `${pr.key}  ${pr.title}`,
    `${pr.state.toLowerCase()} by ${pr.author}, +${pr.additions} -${pr.deletions}, CI ${pr.checks.rollup.toLowerCase()}`,
    pr.url,
    `topic ${detail.topicId ?? 'none'}, tiles ${detail.tileIds.join(', ') || 'none'}`,
  ];
  if (detail.userState?.approvedAt) {
    lines.push(`you approved at ${detail.userState.approvedAt}`);
  }
  lines.push('');
  if (detail.glance) {
    if (detail.glanceStale) {
      lines.push('STALE glance: the PR or your instructions moved since; sync to refresh');
    }
    lines.push(`${detail.glance.verdict}: ${detail.glance.forYou}`);
    lines.push(`does: ${detail.glance.does}`);
    lines.push(`risk: ${detail.glance.risk}`);
    lines.push(`others said: ${detail.glance.othersSaid}`);
    if (detail.glance.pullInReason) {
      lines.push(`pulled in: ${detail.glance.pullInReason}`);
    }
    lines.push('');
  }
  const facts = formatFacts(detail.facts);
  if (facts.length > 0) {
    lines.push(...facts, '');
  }
  for (const view of detail.events) {
    lines.push(`${view.event.at}  [${view.display}]  ${view.event.summary}`);
  }
  return lines.join('\n');
}
