import type { WorkContextInputStats, WorkContextSource, WorkContextView } from '@postpile/core';
import { whenLabel } from './time.ts';

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
  const skipped = stats.skippedProjects ? `; ${stats.skippedProjects} private ${stats.skippedProjects === 1 ? 'project' : 'projects'} skipped` : '';
  return `Read ${k(stats.sentChars)} of ${k(stats.budgetChars)} chars: ${stats.claudeMdFiles} CLAUDE.md, ${stats.memoryFiles} memory files, ${stats.sessions} sessions${dropped}${skipped}`;
}

/** The skip list as the input shows it. */
export function skipText(patterns: string[]): string {
  return patterns.join(', ');
}

/** The input's text as a skip list: comma separated, trimmed, empties dropped. */
export function parseSkipText(text: string): string[] {
  return text
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
}

/** Under the skip list input: what it does and where it comes from. */
export function skipNote(view: Pick<WorkContextView, 'skipPatterns' | 'skipSource' | 'skipConfigFile'>): string {
  const what =
    view.skipPatterns.length === 0
      ? 'Empty: every project folder is read.'
      : 'Project folders with one of these names (as a whole word run) are never read, memory and sessions both.';
  if (view.skipSource === 'env') {
    return `${what} Set by POSTPILE_SWEEP_SKIP, which wins over the saved list until it is unset.`;
  }
  const where = view.skipConfigFile ? `Saved in ${view.skipConfigFile}.` : '';
  const defaults = view.skipSource === 'default' ? ' These are the defaults; saving writes your own list.' : '';
  return `${what} ${where}${defaults}`.trim();
}

/** The footer line: running, failed, or when the digest was written. */
export function sweepStatus(view: WorkContextView, now: Date): string {
  if (view.running) {
    return 'Reading your notes… this takes a minute or two.';
  }
  const updated = view.current ? `Updated ${whenLabel(view.current.createdAt, now)} (v${view.current.version})` : 'Not written yet';
  return view.lastError ? `${updated}. The last refresh failed, so this is the previous version.` : `${updated}.`;
}
