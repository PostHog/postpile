import type { PrDetail, SyncReport, TopicDetail, TopicListItem } from '@code-manager/core';

export function formatSync(report: SyncReport): string {
  const lines = [
    `threads ${report.threads}, PRs fetched ${report.prsFetched}, new events ${report.newEvents}, agent calls ${report.agentCalls}`,
  ];
  if (report.prsSkipped > 0) {
    lines.push(`${report.prsSkipped} PRs left for the next sync (--limit)`);
  }
  if (report.notificationsNotModified) {
    lines.push('notifications unchanged (304)');
  }
  for (const error of report.errors) {
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
  for (const view of detail.events) {
    lines.push(`${view.event.at}  [${view.display}]  ${view.event.summary}`);
  }
  return lines.join('\n');
}
