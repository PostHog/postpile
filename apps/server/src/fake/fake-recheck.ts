import type { MemoryRecheckResult, StaleReason } from '@postpile/core';

/** What a recheck looked at: a dossier line or fact, or a PR's whole glance. */
export type RecheckScope = 'claim' | 'glance';

/** Stale reasons after which the claim no longer applies at all: a real recheck drops it. */
const DROP_REASONS: Partial<Record<StaleReason, string>> = {
  thread_resolved: 'the thread it came from was resolved on GitHub, so the question is settled.',
  pr_closed: 'the PR it came from was closed and nobody picked it up.',
  pr_missing: 'the PR it came from can no longer be read.',
  source_deleted: 'the comment it came from was deleted.',
  left_topic: 'that PR left this topic.',
  person_not_involved: 'that person is no longer on the PR.',
};

/** Stale reasons after which the claim still applies but says too little: a real recheck rewrites it. */
const FIX_REASONS: Partial<Record<StaleReason, string>> = {
  head_moved: 'a newer push changed the PR since this was written.',
  pr_merged: 'the PR was merged since this was written.',
};

/**
 * The fake's stand-in for the memory_recheck call: the answer follows the
 * claim's state, like the real agent reading the same sources. A fresh claim
 * holds; a stale one is fixed or dropped, by why it went stale. No agent
 * call; the "Sample data" pill already says so.
 */
function sentence(reason: string): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

export function sampleRecheckAnswer(text: string, issue: StaleReason | null, scope: RecheckScope): MemoryRecheckResult {
  if (issue === null) {
    const why = scope === 'glance' ? 'nothing on the PR changed since this assessment.' : 'the newest reviews and comments still say the same.';
    return { status: 'answered', outcome: 'holds', text, why: sentence(why) };
  }
  const drop = DROP_REASONS[issue];
  if (drop) {
    return { status: 'answered', outcome: 'drop', text, why: sentence(drop) };
  }
  const fix = FIX_REASONS[issue] ?? 'the sources say something newer.';
  const corrected = scope === 'glance' ? `${text.replace(/\.$/, '')}, as of the latest push.` : `${text.replace(/\.$/, '')} (updated after the latest change).`;
  return { status: 'answered', outcome: 'fix', text: corrected, why: sentence(fix) };
}
