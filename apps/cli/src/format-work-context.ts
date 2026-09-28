import type { WorkContextInputStats, WorkContextSweepResult, WorkContextView } from '@code-manager/core';

function statsLines(stats: WorkContextInputStats): string[] {
  const lines = [
    `input ${stats.sentChars} of ${stats.budgetChars} chars: ${stats.claudeMdFiles} CLAUDE.md, ${stats.memoryFiles} memory files, ` +
      `${stats.sessions} sessions (of ${stats.sessionFilesScanned} session files), ${stats.maskedSecrets} secrets masked`,
  ];
  if (stats.droppedCount > 0) {
    lines.push(`dropped ${stats.droppedCount}:`);
    lines.push(...stats.dropped.map((drop) => `  ${drop.kind} ${drop.ref}: ${drop.reason}`));
    if (stats.droppedCount > stats.dropped.length) {
      lines.push(`  ... and ${stats.droppedCount - stats.dropped.length} more`);
    }
  }
  return lines;
}

/** The sweep outcome, then the digest as it now reads. */
export function formatSweep(result: WorkContextSweepResult, view: WorkContextView): string {
  const lines = [result.message];
  if (result.stats) {
    lines.push(...statsLines(result.stats));
  }
  const current = view.current;
  if (!current) {
    lines.push('', 'no work context stored yet');
    return lines.join('\n');
  }
  lines.push('', `What you're working on (v${current.version}, ${current.createdAt}, ${current.model})`, '', current.summary, '');
  for (const thread of current.threads) {
    const forgotten = thread.forgotten ? ' [forgotten]' : '';
    lines.push(`- ${thread.title}${forgotten}: ${thread.detail}`);
    if (thread.topics.length > 0) {
      lines.push(`    topics: ${thread.topics.map((topic) => topic.name).join(', ')}`);
    }
    for (const source of thread.sources) {
      lines.push(`    why: ${source.kind} ${source.ref}`);
    }
  }
  return lines.join('\n');
}
