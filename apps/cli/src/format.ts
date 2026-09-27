import type { PrDetail, SyncReport, TopicDetail, TopicListItem } from '@code-manager/core';

export function formatSync(report: SyncReport): string {
  const lines = [
    `threads ${report.threads}, PRs fetched ${report.prsFetched}, new events ${report.newEvents}, agent calls ${report.agentCalls}`,
  ];
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
  const lines = [detail.topic.name, detail.topic.summary, ''];
  for (const view of detail.tiles) {
    lines.push(`[${view.state.kind}] ${view.tile.kind}: ${view.tile.title}`);
    for (const reason of view.state.unreadBecause) {
      lines.push(`    ! ${reason.prKey}: ${reason.summary}`);
    }
    for (const pr of view.prs) {
      lines.push(`    ${pr.key}  ${pr.title}  (${pr.provenance.kind}, ${pr.verdict ?? 'no glance'})`);
    }
  }
  return lines.join('\n');
}

export function formatPr(detail: PrDetail): string {
  const lines = [`${detail.pr.key}  ${detail.pr.title}`, detail.pr.url, ''];
  if (detail.glance) {
    lines.push(`${detail.glance.verdict}: ${detail.glance.forYou}`);
    lines.push(`does: ${detail.glance.does}`);
    lines.push(`risk: ${detail.glance.risk}`);
    lines.push(`others said: ${detail.glance.othersSaid}`, '');
  }
  for (const view of detail.events) {
    lines.push(`${view.event.at}  [${view.display}]  ${view.event.summary}`);
  }
  return lines.join('\n');
}
