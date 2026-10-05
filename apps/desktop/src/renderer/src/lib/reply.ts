// What a human comment in the detail pane can be answered with: Reply (in
// its review thread for a code comment, else a new PR comment that quotes
// it) and a thumbs up. Pure, so the activity list and "New since" stay dumb.
import { ADDRESSED_KINDS, findComment, PERSONAL_ASK_KINDS, replyTarget, sameLogin, type ActivityLine, type EventKind, type Pr } from '@postpile/core';

export interface ReplyTarget {
  /** The comment's or review's id: where the reply and the reaction go. */
  commentId: string;
  author: string;
  /** A code comment: the reply goes into its review thread. */
  inThread: boolean;
  /** The file of a code comment, null otherwise. */
  path: string | null;
  /** A comment or a review with text. An approval without text only takes a reaction. */
  canReply: boolean;
  /** The viewer gave it a thumbs up already. */
  viewerReacted: boolean;
  /** The line asks the viewer something: Reply is the emphasized action. */
  asksYou: boolean;
}

/** A person talking: comments, reviews and everything addressed to the viewer. */
const HUMAN_TALK: readonly EventKind[] = ['comment', 'comment_edited', ...ADDRESSED_KINDS, 'review_approved', 'review_changes_requested', 'review_commented'];

/**
 * The reply target of an activity line: its newest event's comment or
 * review. Null for anything that is not a person talking (pushes, bots,
 * lifecycle), for the viewer's own words, and when the snapshot no longer
 * has the comment.
 */
export function replyTargetOf(line: ActivityLine, pr: Pr, viewerLogin: string | null): ReplyTarget | null {
  const newest = line.events[0]?.event;
  if (!newest || newest.isBot || !HUMAN_TALK.includes(newest.kind) || (viewerLogin !== null && sameLogin(newest.actor, viewerLogin))) {
    return null;
  }
  // A personal ask (a mention, a question, a reply to the viewer) makes Reply the emphasized action.
  const asksYou = line.events.some((view) => PERSONAL_ASK_KINDS.includes(view.event.kind));
  const comment = findComment(pr, newest.sourceId);
  if (comment) {
    const inThread = replyTarget(comment).kind === 'thread';
    return {
      commentId: comment.id,
      author: comment.author,
      inThread,
      path: inThread ? comment.path : null,
      canReply: true,
      viewerReacted: comment.viewerReacted ?? false,
      asksYou,
    };
  }
  const review = pr.reviews.find((candidate) => candidate.id === newest.sourceId);
  if (review) {
    return { commentId: review.id, author: review.author, inThread: false, path: null, canReply: false, viewerReacted: review.viewerReacted ?? false, asksYou };
  }
  return null;
}

/**
 * The reply targets of a list of activity lines, newest first, keyed by line
 * id. A comment can show on more than one line (its event and a later edit,
 * a review and the mention in its body); only the newest of them gets the
 * actions, so one comment never has two Reply boxes. It asks the viewer when
 * any of its lines does.
 */
export function replyTargetsOf(lines: ActivityLine[], pr: Pr, viewerLogin: string | null): Map<string, ReplyTarget> {
  const byLine = new Map<string, ReplyTarget>();
  const byComment = new Map<string, ReplyTarget>();
  for (const line of lines) {
    const target = replyTargetOf(line, pr, viewerLogin);
    if (!target) {
      continue;
    }
    const first = byComment.get(target.commentId);
    if (first) {
      first.asksYou = first.asksYou || target.asksYou;
      continue;
    }
    byComment.set(target.commentId, target);
    byLine.set(line.id, target);
  }
  return byLine;
}

/** "ci.yml" from ".github/workflows/ci.yml". */
function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export interface ReplyCopy {
  title: string;
  /** Where it lands, after the title. */
  hint: string;
  submit: string;
}

/** The composer's words for a reply: where it goes, and a button that names the target. */
export function replyCopy(target: ReplyTarget): ReplyCopy {
  if (target.inThread && target.path) {
    return { title: 'Reply in thread', hint: `on ${fileName(target.path)}`, submit: 'Post reply in thread' };
  }
  return { title: `Reply to ${target.author}`, hint: 'new PR comment, quotes their line', submit: `Post reply to ${target.author}` };
}
