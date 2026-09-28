import type { DossierView, MemoryCheck, MemoryTarget } from '@postpile/core';
import { staleLabel } from './memory.ts';

export type CheckTone = 'ok' | 'warn' | 'muted';

export interface CheckLabel {
  text: string;
  tone: CheckTone;
}

/** The verify line at the top of a "Why?" panel. */
export function checkLabel(check: MemoryCheck): CheckLabel {
  if (check.state === 'ok') {
    return { text: 'Checks out against GitHub', tone: 'ok' };
  }
  if (check.state === 'stale') {
    return { text: `Stale: ${check.reason ? staleLabel(check.reason) : 'a check failed'}`, tone: 'warn' };
  }
  if (check.state === 'closed') {
    return { text: `No longer believed${check.note ? `: ${check.note}` : ''}`, tone: 'muted' };
  }
  if (check.state === 'user_only') {
    return { text: 'From your own words, nothing on GitHub to check', tone: 'muted' };
  }
  return { text: 'No source recorded', tone: 'muted' };
}

/** A stable string per target, for the query key. */
export function targetKey(target: MemoryTarget): string {
  return target.kind === 'fact' ? `fact:${target.factId}` : `line:${target.topicId}:${target.version}:${target.path}`;
}

/** Query string for GET /api/memory/sources. */
export function targetQuery(target: MemoryTarget): string {
  const params =
    target.kind === 'fact'
      ? new URLSearchParams({ fact: target.factId })
      : new URLSearchParams({ topic: target.topicId, version: String(target.version), path: target.path });
  return params.toString();
}

/** The "Why?" target of a line in the dossier the user is looking at. */
export function lineTarget(topicId: string, view: DossierView, path: string): MemoryTarget {
  return { kind: 'dossier_line', topicId, version: view.version, path };
}

/** Path of a recent change shown in "Since you last looked", which lists a subset of recentChanges. */
export function changePath(view: DossierView, change: { at: string; text: string }): string | null {
  const index = view.dossier.recentChanges.findIndex((candidate) => candidate.at === change.at && candidate.text === change.text);
  return index === -1 ? null : `recentChanges[${index}]`;
}
