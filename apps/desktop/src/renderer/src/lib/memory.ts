import type { DossierChange, DossierIssue, DossierStatus, DossierView, FactRef, StaleReason } from '@code-manager/core';
import { prNumber } from './tiles.ts';

const STATUS_LABELS: Record<DossierStatus, string> = {
  starting: 'Starting',
  active: 'Active',
  blocked: 'Blocked',
  winding_down: 'Winding down',
  finished: 'Finished',
};

const STALE_LABELS: Record<StaleReason, string> = {
  pr_missing: 'PR not synced',
  pr_closed: 'PR closed since',
  pr_merged: 'PR merged since',
  head_moved: 'PR moved since',
  person_not_involved: 'no longer involved',
  source_deleted: 'source deleted',
  thread_resolved: 'thread resolved',
  left_topic: 'left the topic',
};

/** Recent changes shown when the topic was never marked seen. */
const RECENT_WHEN_NEVER_SEEN = 3;

export function statusLabel(status: DossierStatus): string {
  return STATUS_LABELS[status];
}

export function staleLabel(reason: StaleReason): string {
  return STALE_LABELS[reason];
}

/** "#41902", "#41902 comment", "#41902 review", ... */
export function refLabel(ref: FactRef): string {
  const number = `#${prNumber(ref.prKey)}`;
  return ref.kind === 'pr' || ref.kind === 'event' ? number : `${number} ${ref.kind}`;
}

/** Why a dossier claim at `path` (e.g. "openQuestions[2]") failed verification, if it did. */
export function claimStaleReason(path: string, issues: DossierIssue[]): StaleReason | null {
  return issues.find((issue) => issue.path === path)?.reason ?? null;
}

export interface SinceLastLooked {
  heading: string;
  changes: DossierChange[];
  /** Extra counts under the list, e.g. "3 new events · 2 facts learned". Empty when nothing to add. */
  counts: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The "Since you last looked" block. A topic never marked seen has no cursor,
 * so it shows the newest few recent changes instead.
 */
export function sinceLastLooked(view: DossierView): SinceLastLooked {
  const seen = view.changesSinceSeen;
  if (!seen) {
    return { heading: 'Recent changes', changes: view.dossier.recentChanges.slice(0, RECENT_WHEN_NEVER_SEEN), counts: '' };
  }
  const counts: string[] = [];
  if (seen.newEvents > 0) {
    counts.push(plural(seen.newEvents, 'new event', 'new events'));
  }
  if (seen.factsAdded.length > 0) {
    counts.push(plural(seen.factsAdded.length, 'fact learned', 'facts learned'));
  }
  if (seen.factsClosed.length > 0) {
    counts.push(plural(seen.factsClosed.length, 'fact closed', 'facts closed'));
  }
  return { heading: 'Since you last looked', changes: seen.changes, counts: counts.join(' · ') };
}
