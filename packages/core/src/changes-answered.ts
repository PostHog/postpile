// "Addressed your changes": the viewer requested changes on someone else's
// PR, and the author has since pushed or replied. The move is back with the
// viewer even when the author never pressed "re-request review". Rules only;
// whose turn, tiers, for whom, loudness and pings all read it from here.
// DESIGN.md "Whose turn" has the rule.
import { isBot } from './bots.ts';
import { PUSH_KINDS } from './kinds.ts';
import { sameLogin } from './mentions.ts';
import { newestVerdictBy } from './review-request.ts';
import type { EventKind, IsoTime, Pr, Viewer } from './types.ts';

export interface ChangesAnswer {
  /** The author pushed commits (or force-pushed) after `since`. */
  pushed: boolean;
  /** The author commented, reviewed or replied in a thread after `since`. */
  replied: boolean;
  /** The viewer's last word on the PR: their changes request, or a later comment or review. */
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

function newest(times: IsoTime[]): IsoTime | null {
  let best: IsoTime | null = null;
  for (const time of times) {
    if (best === null || time > best) {
      best = time;
    }
  }
  return best;
}

/** When the viewer last spoke on the PR (comment or submitted review), or null. */
function viewerLastWord(pr: Pr, viewer: Viewer): IsoTime | null {
  const comments = pr.comments.filter((c) => sameLogin(c.author, viewer.login)).map((c) => c.createdAt);
  const reviews = pr.reviews.filter((r) => sameLogin(r.author, viewer.login) && r.state !== 'PENDING').map((r) => r.submittedAt);
  return newest([...comments, ...reviews]);
}

/**
 * A push counts from any human but the viewer: a commit's author can be a
 * git name ("Pim Laptop") rather than the login, and bots only rebase.
 */
function isPusher(login: string, viewer: Viewer): boolean {
  return !isBot(login) && !sameLogin(login, viewer.login);
}

function pushedAfter(pr: Pr, viewer: Viewer, since: IsoTime): boolean {
  const commit = pr.commits.some((c) => c.committedAt > since && isPusher(c.author, viewer));
  const forcePush = pr.timeline.some((item) => item.kind === 'head_ref_force_pushed' && item.at > since && isPusher(item.actor, viewer));
  return commit || forcePush;
}

function repliedAfter(pr: Pr, since: IsoTime): boolean {
  const comment = pr.comments.some((c) => sameLogin(c.author, pr.author) && c.createdAt > since);
  const review = pr.reviews.some((r) => sameLogin(r.author, pr.author) && r.state !== 'PENDING' && r.submittedAt > since);
  return comment || review;
}

/**
 * The author answered the viewer's changes request: the viewer's newest
 * verdict on an open PR someone else wrote asks for changes, and since the
 * viewer's last word (the request, or a later comment or re-review) the
 * author pushed or replied. Null otherwise, and always on a draft: nobody
 * re-reviews a draft (its author's thread reply is a personal ask instead).
 */
export function changesAnswered(pr: Pr, viewer: Viewer): ChangesAnswer | null {
  if (pr.state !== 'OPEN' || pr.isDraft || sameLogin(pr.author, viewer.login)) {
    return null;
  }
  const verdict = newestVerdictBy(pr.reviews, viewer.login);
  if (verdict === null || verdict.state !== 'CHANGES_REQUESTED') {
    return null;
  }
  const since = newest([verdict.submittedAt, viewerLastWord(pr, viewer) ?? verdict.submittedAt])!;
  const pushed = pushedAfter(pr, viewer, since);
  const replied = repliedAfter(pr, since);
  if (!pushed && !replied) {
    return null;
  }
  return { pushed, replied, since };
}

/**
 * One event is part of the author's answer: a push by a human other than
 * the viewer, or a comment, review or reply by the author, after the
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
    return isPusher(event.actor, viewer);
  }
  return sameLogin(event.actor, pr.author);
}
