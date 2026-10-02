import type { Glance, ReviewNoteKind, Verdict } from '@postpile/core';

// The author wrote the diff, so a note that retells it or lists what was
// checked tells them nothing. Only what they could not know survives.
const WHAT_TO_WRITE: Record<ReviewNoteKind, string> = {
  approve:
    'The user is approving this PR. Write the note that goes with the approval: one or two sentences, never more. ' +
    'Never describe what the PR does or list what was checked: the author wrote it. ' +
    'Say only what the author does not already know: a risk to watch after merge, a follow-up, or a non-blocking point. ' +
    'With nothing like that, one short sentence is the whole note. No questions, no @mentions, no praise.',
  comment:
    'The user is leaving a comment-only review: it answers the review request without approving and without asking for changes. ' +
    'Write one or two sentences, never more, with the one point that stood out when reading the PR: an observation, a doubt ' +
    'or a thing worth a look, naming the file or identifier it is about. ' +
    'Never describe what the PR does: the author wrote it. Do not say it is approved or ready to merge. No @mentions, no praise.',
};

const VERDICT_WORDS: Record<Verdict, string> = {
  LOOKS_SAFE: 'looks safe',
  LOOK_CLOSER: 'look closer',
  NOT_YOURS: 'not yours to review',
};

/** The behavioural instruction for `agent.draftComment`: what the note is for. Trusted text only. */
export function reviewNoteIntent(kind: ReviewNoteKind): string {
  return WHAT_TO_WRITE[kind];
}

/**
 * What the agent's glance already said about the PR (may be from an older
 * head), so the draft does not start from nothing. The fields can echo
 * PR-author text, so these lines travel as fenced notes, never in the intent.
 * The glance's "does" line stays out: handed a summary of the change, the
 * draft retold it to the author. "For you" stays out too: it can carry the
 * user's local work context, which must never reach a GitHub-facing note.
 */
export function reviewNoteGlanceNotes(glance: Glance | null): string[] {
  if (glance === null) {
    return [];
  }
  return [`Verdict: ${VERDICT_WORDS[glance.verdict]}`, `Risk: ${glance.risk}`];
}
