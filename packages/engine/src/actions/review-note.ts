import type { Glance, ReviewNoteKind, Verdict } from '@postpile/core';

// The author wrote the diff, so a note that retells it or lists what was
// checked tells them nothing. And the user posts it from PostPile without the
// agent's view of the diff, so a point they cannot place reads odd under their
// name (2026-10-06): plain words, one point at most, nothing to nitpick.
const WHAT_TO_WRITE: Record<ReviewNoteKind, string> = {
  approve:
    'The user is approving this PR. PostPile starts the note with a short opener of its own, such as "Looks good.": ' +
    'write only what follows it, never an opener, greeting or verdict yourself. ' +
    'That is at most one short sentence, and only for a point that matters: a risk to watch after merge or a follow-up worth doing. ' +
    'Say it in plain words anyone on the team understands without having read the diff, ' +
    'a point the user can stand behind without having read the diff in detail. ' +
    'With nothing that important, the body is an empty string: the opener alone is the whole note, and that is the usual case. ' +
    'Never describe what the PR does and never list what was checked or what holds up: the author wrote it. ' +
    'No nitpicks (naming, style, small edge cases). Avoid code identifiers and file paths unless the point cannot be said without one. ' +
    'No questions, no @mentions, no praise.',
  comment:
    'The user is leaving a comment-only review: it answers the review request without approving and without asking for changes. ' +
    'Write one or two short sentences with the one point most worth a look: an observation or a doubt that matters, ' +
    'such as a risk or a missing piece. ' +
    'Say it in plain words anyone on the team understands without having read the diff, ' +
    'a point the user can stand behind without having read the diff in detail. ' +
    'Never describe what the PR does and never list what was checked: the author wrote it. ' +
    'No nitpicks (naming, style, small edge cases). Name a file or identifier only when the point cannot be said without it. ' +
    'Do not say it is approved or ready to merge. No @mentions, no praise.',
};

/**
 * How an approve note starts. Picked in code, not by the agent, and never
 * the same twice in a row, so a day of approvals does not read like a bot.
 */
export const APPROVE_OPENERS = ['Looks good.', 'LGTM.', 'Looks good to me.', 'Good to go.', 'All good here.'] as const;

/** The meta key holding the last opener used, so the rotation survives a restart. */
export const LAST_APPROVE_OPENER_KEY = 'approve_note_last_opener';

/** The opener after `last` in the list; the first one when there is no last (or it left the list). */
export function nextApproveOpener(last: string | null): string {
  const index = APPROVE_OPENERS.findIndex((opener) => opener === last);
  return APPROVE_OPENERS[(index + 1) % APPROVE_OPENERS.length] ?? APPROVE_OPENERS[0];
}

/** The approve note: the opener, then the agent's one point when it had one. */
export function approveNoteBody(opener: string, point: string): string {
  const trimmed = point.trim();
  return trimmed === '' ? opener : `${opener} ${trimmed}`;
}

/** The agent writes the whole note for a comment review, only the point after the opener for an approval. */
export function reviewNotePointOnly(kind: ReviewNoteKind): boolean {
  return kind === 'approve';
}

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
