// "Tighten" on the Scouts intro card (DESIGN.md "Scouts" › The intro card):
// the Want / Noise labels on the dry run's examples, the versions the card
// went through for Undo, and the words around them. Card state only:
// nothing here is stored.
import { SCOUT_REFINE_MIN_LABELS, type PrKey, type ScoutExampleLabel, type ScoutLabel, type ScoutTrial, type ScoutTrialExample } from '@postpile/core';
import { exampleRef } from './scout-intro.ts';
import { plural } from './plural.ts';

/** The card's labels by PR key. They carry over from one version to the next, so a PR keeps its label wherever it shows. */
export type ScoutLabels = Readonly<Record<PrKey, { label: ScoutLabel; why: string }>>;

/** Want or Noise on an example; the same button again takes the label off, note and all. */
export function toggleLabel(labels: ScoutLabels, prKey: PrKey, label: ScoutLabel): ScoutLabels {
  const next = { ...labels };
  if (labels[prKey]?.label === label) {
    delete next[prKey];
    return next;
  }
  next[prKey] = { label, why: labels[prKey]?.why ?? '' };
  return next;
}

/** The optional "why" on a labeled example; an unlabeled one takes no note. */
export function setLabelWhy(labels: ScoutLabels, prKey: PrKey, why: string): ScoutLabels {
  const entry = labels[prKey];
  if (entry === undefined) {
    return labels;
  }
  return { ...labels, [prKey]: { ...entry, why } };
}

export function labelCount(labels: ScoutLabels): number {
  return Object.keys(labels).length;
}

/** Every label, shown or not: a Want the new version no longer pulls must still reach the refine. */
export function labelsForRequest(labels: ScoutLabels): ScoutExampleLabel[] {
  return Object.entries(labels).map(([prKey, entry]) => ({ prKey, label: entry.label, why: entry.why.trim() }));
}

/** One version of the scout on the card: what Turn on would write and what its dry run found. */
export interface ScoutVersion {
  prompt: string;
  paths: string[];
  trial: ScoutTrial | null;
  /** The tightening that made this version; null for the checked one. */
  tightening: { summary: string; droppedHints: number; lostWants: ScoutTrialExample[] } | null;
}

/** The card's versions after a check: just the checked one. */
export function checkedVersions(prompt: string, paths: string[], trial: ScoutTrial | null): ScoutVersion[] {
  return [{ prompt, paths, trial, tightening: null }];
}

/** The version the card shows and Turn on writes: the newest. */
export function currentVersion(versions: ScoutVersion[]): ScoutVersion {
  return versions[versions.length - 1]!;
}

/** The version before the current one, for the before/after; null for the checked version. */
export function previousVersion(versions: ScoutVersion[]): ScoutVersion | null {
  return versions.length > 1 ? versions[versions.length - 2]! : null;
}

export function pushVersion(versions: ScoutVersion[], version: ScoutVersion): ScoutVersion[] {
  return [...versions, version];
}

/** "Undo this tightening": one step back. The checked version always stays. */
export function undoVersion(versions: ScoutVersion[]): ScoutVersion[] {
  return versions.length > 1 ? versions.slice(0, -1) : versions;
}

/** Why "Tighten" cannot run now, for its `disabled` and `title`; null when it can. */
export function tightenBlockedReason(input: { labels: ScoutLabels; trial: ScoutTrial | null; agentOff: string | null }): string | null {
  if (input.agentOff !== null) {
    return input.agentOff;
  }
  if (input.trial === null || input.trial.session === null) {
    return 'Tighten needs a dry run to compare against; check the scout again';
  }
  const missing = SCOUT_REFINE_MIN_LABELS - labelCount(input.labels);
  if (missing > 0) {
    return `Mark ${plural(missing, 'more example')} Want or Noise first`;
  }
  return null;
}

/** The line beside "Tighten": what it needs, or what it does. */
export function tightenHint(labels: ScoutLabels): string {
  const count = labelCount(labels);
  if (count < SCOUT_REFINE_MIN_LABELS) {
    return `Mark at least ${SCOUT_REFINE_MIN_LABELS} examples Want or Noise, then tighten the scout from them (${count} of ${SCOUT_REFINE_MIN_LABELS}).`;
  }
  return 'Tighten rewrites the prompt and path hints from your labels, then runs the dry run again on the same PRs.';
}

/** "Tightened: 14 → 4 PRs on the last 2 days." */
export function tightenedHeading(before: ScoutTrial | null, after: ScoutTrial | null): string {
  if (after === null) {
    return 'Tightened.';
  }
  const count = `${after.pulled === 1 ? '1 PR' : `${after.pulled} PRs`} on the last ${after.days} days`;
  return before === null ? `Tightened: ${count}.` : `Tightened: ${before.pulled} → ${count}.`;
}

/** "Lost 1 PR you wanted: #2688 Billing: expose invoices"; null when none was lost. */
export function lostWantsText(lost: ScoutTrialExample[], repos: string[]): string | null {
  if (lost.length === 0) {
    return null;
  }
  const names = lost.map((example) => `${exampleRef(example.prKey, repos)} ${example.title}`).join('; ');
  return `Lost ${plural(lost.length, 'PR')} you wanted: ${names}`;
}

/** The path hints before and after, each once, in the new order with the removed ones after. */
export function pathsChange(before: string[], after: string[]): { hint: string; change: 'kept' | 'added' | 'removed' }[] {
  const kept = after.map((hint) => ({ hint, change: before.includes(hint) ? ('kept' as const) : ('added' as const) }));
  const removed = before.filter((hint) => !after.includes(hint)).map((hint) => ({ hint, change: 'removed' as const }));
  return [...kept, ...removed];
}

/** The words of a prompt that changed, with whether text was left out before or after them. */
export interface PromptPart {
  text: string;
  cutStart: boolean;
  cutEnd: boolean;
}

/**
 * What changed between two prompts, word by word: the words the old one
 * had and the new one does not, and the other way round, without the words
 * both start and end with. A skip rule added at the end shows as just that
 * rule, not three lines of a prompt that stayed the same. Null when the
 * prompt did not change.
 */
export function promptChange(before: string, after: string): { removed: PromptPart; added: PromptPart } | null {
  const old = before.trim().split(/\s+/);
  const now = after.trim().split(/\s+/);
  if (old.join(' ') === now.join(' ')) {
    return null;
  }
  let start = 0;
  while (start < old.length && start < now.length && old[start] === now[start]) {
    start++;
  }
  let end = 0;
  while (end < old.length - start && end < now.length - start && old[old.length - 1 - end] === now[now.length - 1 - end]) {
    end++;
  }
  const part = (words: string[]): PromptPart => ({ text: words.slice(start, words.length - end).join(' '), cutStart: start > 0, cutEnd: end > 0 });
  return { removed: part(old), added: part(now) };
}
