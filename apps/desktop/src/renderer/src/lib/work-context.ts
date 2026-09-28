import type { WorkContextInputStats, WorkContextSource, WorkContextView } from '@postpile/core';
import { ageLabel } from './time.ts';

const KIND_LABELS: Record<WorkContextSource['kind'], string> = {
  claude_md: 'CLAUDE.md',
  memory: 'Memory file',
  session: 'Session',
};

/** "Session · posthog · 2026-09-27 10:01 · "Depot pool"" for the Why? list. */
export function sourceLabel(source: WorkContextSource): string {
  return `${KIND_LABELS[source.kind]} · ${source.ref}`;
}

/** "Read 41k of 60k chars: 2 CLAUDE.md, 18 memory files, 26 sessions; 3 left out" */
export function inputLine(stats: WorkContextInputStats): string {
  const k = (chars: number) => `${Math.round(chars / 1000)}k`;
  const dropped = stats.droppedCount > 0 ? `; ${stats.droppedCount} left out` : '';
  return `Read ${k(stats.sentChars)} of ${k(stats.budgetChars)} chars: ${stats.claudeMdFiles} CLAUDE.md, ${stats.memoryFiles} memory files, ${stats.sessions} sessions${dropped}`;
}

/** The footer line: running, failed, or when the digest was written. */
export function sweepStatus(view: WorkContextView, now: Date): string {
  if (view.running) {
    return 'Reading your notes… this takes a minute or two.';
  }
  const updated = view.current ? `Updated ${ageLabel(view.current.createdAt, now)} ago (v${view.current.version})` : 'Not written yet';
  return view.lastError ? `${updated}. The last refresh failed, so this is the previous version.` : `${updated}.`;
}
