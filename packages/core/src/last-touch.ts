// The viewer's last touch on a PR: the newest of their own actions on it.
// One definition for "New since you looked" (`whatsNew`'s anchor), for
// "You already dealt with it" (events before the touch count as seen) and
// for the quiet mark-read after it. Rules only, no IO. DESIGN.md "You
// already dealt with it".
import { PUSH_KINDS } from './kinds.ts';
import { sameLogin } from './mentions.ts';
import type { IsoTime, Pr, PrEvent, Viewer } from './types.ts';

/** GitHub's committer on commits made in the web UI (a suggestion, "Update branch"), as login or as name. */
const WEB_FLOW_COMMITTERS = ['web-flow', 'GitHub'];

/**
 * What the viewer did: their review (changes request, approval, review
 * comment), a comment or thread reply, a push to their own PR, or merging or
 * closing the PR themselves.
 */
export type TouchKind = 'changes_request' | 'approval' | 'review' | 'comment' | 'push' | 'merge' | 'close';

export interface Touch {
  kind: TouchKind;
  at: IsoTime;
}

export const TOUCH_KINDS: readonly TouchKind[] = ['changes_request', 'approval', 'review', 'comment', 'push', 'merge', 'close'];

/**
 * Touches that say the viewer read what came before: a review or a comment.
 * Pushing code does not mean reading the review comments, and a merge or
 * close does not either, so the quiet mark-read on GitHub leaves those out.
 */
export const READING_TOUCH_KINDS: readonly TouchKind[] = ['changes_request', 'approval', 'review', 'comment'];

/** One of the viewer's own events; CI results and other actor-less events never are. */
export function isOwnEvent(event: PrEvent, viewer: Viewer): boolean {
  return event.actor !== '' && sameLogin(event.actor, viewer.login);
}

/**
 * The viewer pushed this: a force push they did (the timeline names the
 * pusher), or a commit they committed, or one GitHub's web UI committed
 * with them as author. The commit author alone is no evidence: a
 * collaborator's or a bot's cherry-pick or rebase keeps the viewer as author
 * (Codex review on PR #10). A snapshot without the committer is no evidence.
 */
function pushedByViewer(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (event.kind === 'force_pushed') {
    return isOwnEvent(event, viewer);
  }
  const committer = pr.commits.find((commit) => commit.oid === event.sourceId)?.committer;
  if (!committer) {
    return false;
  }
  return sameLogin(committer, viewer.login) || (WEB_FLOW_COMMITTERS.includes(committer) && isOwnEvent(event, viewer));
}

/**
 * The touch kind of one event, null when it is not the viewer's or not a
 * touch. A push counts only on the viewer's own PR, and only with evidence
 * that the viewer pushed (`pushedByViewer`), not just authored the commit.
 */
export function touchKindOf(event: PrEvent, pr: Pr, viewer: Viewer): TouchKind | null {
  if (PUSH_KINDS.includes(event.kind)) {
    return sameLogin(pr.author, viewer.login) && pushedByViewer(event, pr, viewer) ? 'push' : null;
  }
  if (!isOwnEvent(event, viewer)) {
    return null;
  }
  switch (event.kind) {
    case 'review_changes_requested':
      return 'changes_request';
    case 'review_approved':
      return 'approval';
    case 'review_commented':
      return 'review';
    case 'comment':
    case 'reply_to_user':
    case 'question_to_user':
    case 'mention':
    case 'team_mention':
      return 'comment';
    case 'merged':
    case 'merged_without_review':
      return 'merge';
    case 'closed':
      return 'close';
    default:
      return null;
  }
}

export interface TouchOptions {
  /** Only touches strictly before this time. */
  before?: IsoTime;
  /** Which touches count; all of them when left out. */
  kinds?: readonly TouchKind[];
}

/** The viewer's newest touch on the PR (the later one on a tie), null when they never touched it. */
export function lastTouch(pr: Pr, events: PrEvent[], viewer: Viewer, options: TouchOptions = {}): Touch | null {
  const kinds = options.kinds ?? TOUCH_KINDS;
  let touch: Touch | null = null;
  for (const event of events) {
    const kind = touchKindOf(event, pr, viewer);
    if (kind === null || !kinds.includes(kind)) {
      continue;
    }
    if (options.before !== undefined && event.at >= options.before) {
      continue;
    }
    if (touch === null || event.at >= touch.at) {
      touch = { kind, at: event.at };
    }
  }
  return touch;
}

/**
 * Unseen events at or before the viewer's last touch, the touch itself
 * included: the viewer has seen them, however they acted (github.com, the
 * gh CLI, GitHub Mobile, an agent commenting as them). Empty when they never
 * touched the PR.
 */
export function eventsSeenByTouch(pr: Pr, events: PrEvent[], viewer: Viewer): { ids: string[]; touch: Touch | null } {
  const touch = lastTouch(pr, events, viewer);
  if (touch === null) {
    return { ids: [], touch: null };
  }
  const ids = events.filter((event) => event.seenAt === null && event.at <= touch.at).map((event) => event.id);
  return { ids, touch };
}
