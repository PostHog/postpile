import type { Glance, ReviewNoteKind, Verdict } from '@postpile/core';

const WHAT_TO_WRITE: Record<ReviewNoteKind, string> = {
  approve:
    'The user is approving this PR. Write a one- or two-line note to go with the approval: what was checked and why it is fine. ' +
    'No questions, no @mentions, no praise padding.',
  comment:
    'The user is leaving a comment-only review: it answers the review request without approving and without asking for changes. ' +
    'Write a one- or two-line note with what stood out when reading the PR (observations, small doubts, things worth a look). ' +
    'Do not say it is approved or ready to merge. No @mentions.',
};

const VERDICT_WORDS: Record<Verdict, string> = {
  LOOKS_SAFE: 'looks safe',
  LOOK_CLOSER: 'look closer',
  NOT_YOURS: 'not yours to review',
};

/**
 * The intent for `agent.draftComment` behind the detail pane's review note
 * popover: what the note is for, plus what the agent's glance already said
 * about the PR (may be from an older head), so the draft does not start from
 * nothing.
 */
export function reviewNoteIntent(kind: ReviewNoteKind, glance: Glance | null): string {
  if (glance === null) {
    return WHAT_TO_WRITE[kind];
  }
  const known = [`Does: ${glance.does}`, `Verdict: ${VERDICT_WORDS[glance.verdict]}`, `Risk: ${glance.risk}`];
  return `${WHAT_TO_WRITE[kind]}\nWhat PostPile's earlier read of this PR said (a summary, may predate the newest commits):\n${known.join('\n')}`;
}
