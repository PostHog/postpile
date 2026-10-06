// "Addressed your changes": the viewer requested changes on someone else's
// PR, and the author has since pushed or replied. The move is back with the
// viewer even when the author never pressed "re-request review". Rules only;
// whose turn, tiers, for whom, loudness and pings all read it from here.
// DESIGN.md "Whose turn" has the rule.
import { isBot } from './bots.ts';
import { PUSH_KINDS } from './kinds.ts';
import { lastSpokeAt, spokeAfter } from './last-touch.ts';
import { sameLogin } from './mentions.ts';
import { isPrOwner, prOwners } from './pr-owners.ts';
import { changesRequestedByAll, newestVerdictBy } from './review-request.ts';
import type { EventKind, IsoTime, Pr, Viewer } from './types.ts';

export interface ChangesAnswer {
  /** The author pushed commits (or force-pushed) after `since`. */
  pushed: boolean;
  /** The author commented, reviewed or replied in a thread after `since`; bot talk is no reply (`lastSpokeAt`). */
  replied: boolean;
  /** The viewer's last word on the PR: their changes request, or a later comment or review that is not bot talk. */
  since: IsoTime;
}

/** The loudness reason for the author's push or reply; pings read it for the headline. */
export const CHANGES_ANSWERED_REASON = 'addressed your changes';

/** Author events that count as answering the changes request. Thread replies are reply_to_user etc. */
const ANSWER_KINDS: readonly EventKind[] = [
  ...PUSH_KINDS,
  'comment',
  'review_commented',
  'reply_to_user',
  'question_to_user',
  'mention',
];

/**
 * A push counts from any human but the reviewer: a commit's author can be a
 * git name ("Pim Laptop") rather than the login, and bots only rebase.
 */
function isPusher(login: string, reviewer: string): boolean {
  return !isBot(login) && !sameLogin(login, reviewer);
}

/** Someone other than `reviewer` (and not a bot) pushed commits or force-pushed after `since`. */
function pushedAfter(pr: Pr, reviewer: string, since: IsoTime): boolean {
  const commit = pr.commits.some((c) => c.committedAt > since && isPusher(c.author, reviewer));
  const forcePush = pr.timeline.some((item) => item.kind === 'head_ref_force_pushed' && item.at > since && isPusher(item.actor, reviewer));
  return commit || forcePush;
}

/**
 * The author answered the viewer's changes request: the viewer's newest
 * verdict on an open PR someone else owns (`prOwners`) asks for changes, and
 * since the viewer's last word (the request, or a later comment or
 * re-review) someone pushed or an owner replied. Null otherwise, and always on a draft: nobody
 * re-reviews a draft (its author's thread reply is a personal ask instead).
 */
export function changesAnswered(pr: Pr, viewer: Viewer): ChangesAnswer | null {
  if (pr.state !== 'OPEN' || pr.isDraft || isPrOwner(pr, viewer.login)) {
    return null;
  }
  const verdict = newestVerdictBy(pr.reviews, viewer.login);
  if (verdict === null || verdict.state !== 'CHANGES_REQUESTED') {
    return null;
  }
  // The verdict is a submitted review, so the viewer's last word is never older than it.
  const since = lastSpokeAt(pr, viewer.login) ?? verdict.submittedAt;
  const pushed = pushedAfter(pr, viewer.login, since);
  const replied = prOwners(pr).some((owner) => spokeAfter(pr, owner, since));
  if (!pushed && !replied) {
    return null;
  }
  return { pushed, replied, since };
}

/**
 * One event is part of the author's answer: a push by a human other than
 * the viewer, or a comment, review or reply by an owner, after the
 * viewer's last word, on a non-draft PR whose changes request was answered.
 */
export function isChangesAnswerEvent(event: { kind: EventKind; actor: string; at: IsoTime }, pr: Pr, viewer: Viewer): boolean {
  if (!ANSWER_KINDS.includes(event.kind)) {
    return false;
  }
  const answer = changesAnswered(pr, viewer);
  if (answer === null || event.at <= answer.since) {
    return false;
  }
  if (PUSH_KINDS.includes(event.kind)) {
    return isPusher(event.actor, viewer.login);
  }
  return isPrOwner(pr, event.actor);
}

/**
 * The move is back with a reviewer who asked for changes: their newest
 * verdict asks for changes, someone else pushed after it, and they are a
 * requested reviewer again (re-requested; GitHub drops a reviewer from the
 * requested list once they review). Whose turn then names them, "ada to
 * re-review", instead of the author (2026-09-29).
 */
export function reReviewAsked(pr: Pr, reviewer: string): boolean {
  if (pr.state !== 'OPEN' || !pr.reviewerUsers.some((login) => sameLogin(login, reviewer))) {
    return false;
  }
  const verdict = newestVerdictBy(pr.reviews, reviewer);
  if (verdict === null || verdict.state !== 'CHANGES_REQUESTED') {
    return false;
  }
  return pushedAfter(pr, reviewer, verdict.submittedAt);
}

/**
 * Where the standing change requests leave the PR (2026-09-29).
 * address: the author moves first, since at least one request has no
 * re-review asked after the author's push (`reReviewAsked`); `by` names the
 * first of them. re_review: every request has one; `by` names the first
 * reviewer. Every request counts, so "Bob to re-review" never hides open
 * work for Carol.
 */
export type StandingChanges = { kind: 'address' | 're_review'; by: string };

/** See `StandingChanges`. `except` leaves one reviewer out (the viewer, on someone else's PR). Null without a standing request. */
export function standingChanges(pr: Pr, except: string | null = null): StandingChanges | null {
  const reviewers = changesRequestedByAll(pr).filter((login) => except === null || !sameLogin(login, except));
  const first = reviewers[0];
  if (first === undefined) {
    return null;
  }
  const waiting = reviewers.find((login) => !reReviewAsked(pr, login));
  return waiting === undefined ? { kind: 're_review', by: first } : { kind: 'address', by: waiting };
}
