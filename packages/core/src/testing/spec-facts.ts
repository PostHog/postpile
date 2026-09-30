// PR facts restated from the raw snapshot, for the generated world only
// (testing/build-board.ts): who is automation, who is on the team, what a
// comment says, reviews and approvals, review requests, the viewer's
// touches, and the author's answer to a changes request. The spec oracles
// build on these instead of calling the rule under test, so a mutated rule
// can never move both sides of a check. Nothing here imports a rule module;
// only `sameLogin` and the builder's names are shared.
import { sameLogin } from '../mentions.ts';
import type { Comment, IsoTime, Pr, Review, TimelineItem, UserPrState, Viewer } from '../types.ts';
import type { CommentText } from './board-spec.ts';
import { AUTOMATION_LOGINS, COMMENT_BODIES } from './build-board.ts';

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** A bot account or no actor at all (a CI result). */
export function isAutomationLogin(login: string): boolean {
  return login === '' || AUTOMATION_LOGINS.some((bot) => sameLogin(bot, login));
}

export function isViewerLogin(viewer: Viewer, login: string): boolean {
  return login !== '' && sameLogin(login, viewer.login);
}

/** On the viewer's team by the fetched member list; nobody is while the list is unknown. */
export function isKnownTeammate(viewer: Viewer, login: string): boolean {
  return (viewer.teamMembers ?? []).some((member) => sameLogin(member, login));
}

/** A review request subject that is the viewer or one of their teams. */
export function asksViewer(viewer: Viewer, subject: string | null): boolean {
  if (subject === null) {
    return false;
  }
  return sameLogin(subject, viewer.login) || viewer.teams.some((team) => sameLogin(team, subject));
}

/** A request subject that is one of the viewer's teams (not the viewer). */
export function isViewerTeam(viewer: Viewer, subject: string | null): boolean {
  return subject !== null && viewer.teams.some((team) => sameLogin(team, subject));
}

// ---------------------------------------------------------------------------
// What a comment says (the builder writes one body per CommentText)
// ---------------------------------------------------------------------------

export function commentText(body: string): CommentText | null {
  const entry = (Object.entries(COMMENT_BODIES) as [CommentText, string][]).find(([, text]) => text === body);
  return entry ? entry[0] : null;
}

/** "@viewer" in the body: a mention, or a question when it asks one. */
export function mentionsViewer(body: string): boolean {
  const text = commentText(body);
  return text === 'mention' || text === 'question';
}

export function asksQuestion(body: string): boolean {
  return commentText(body) === 'question';
}

export function mentionsViewerTeam(body: string): boolean {
  return commentText(body) === 'team_mention';
}

/** Automation wrote it: a bot account, or a body that says it is automated. */
export function isMachineComment(comment: Pick<Comment, 'author' | 'body'>): boolean {
  return isAutomationLogin(comment.author) || commentText(comment.body) === 'bot_marker';
}

export function saysDeploy(body: string): boolean {
  return commentText(body) === 'deploy';
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Approve, request changes or dismissed: a verdict. A comment review or an unsent one is none. */
export function isVerdict(review: Review): boolean {
  return review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED';
}

/** The newest verdict by `login` (the first of two at the same time), or null. */
export function newestVerdict(pr: Pr, login: string): Review | null {
  let newest: Review | null = null;
  for (const review of pr.reviews) {
    if (isVerdict(review) && sameLogin(review.author, login) && (newest === null || review.submittedAt > newest.submittedAt)) {
      newest = review;
    }
  }
  return newest;
}

/** Everyone whose latest verdict asks for changes, in the order they first gave a verdict. */
export function standingChangesBy(pr: Pr): string[] {
  const order: string[] = [];
  const latest = new Map<string, Review>();
  for (const review of pr.reviews.toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (!isVerdict(review)) {
      continue;
    }
    const who = review.author.toLowerCase();
    if (!latest.has(who)) {
      order.push(who);
    }
    latest.set(who, review);
  }
  return order.filter((who) => latest.get(who)!.state === 'CHANGES_REQUESTED').map((who) => latest.get(who)!.author);
}

/** The viewer's newest verdict on someone else's PR asks for changes. */
export function viewerAskedForChanges(pr: Pr, viewer: Viewer): boolean {
  return !sameLogin(pr.author, viewer.login) && newestVerdict(pr, viewer.login)?.state === 'CHANGES_REQUESTED';
}

/**
 * The viewer approved, on any commit: the in-app approval until GitHub
 * shows a verdict of theirs on the approved commit (and no newer verdict of
 * theirs), else their newest verdict on GitHub is an approval.
 */
export function viewerApproved(pr: Pr, viewer: Viewer | null, userState: UserPrState | null): boolean {
  const newest = viewer === null ? null : newestVerdict(pr, viewer.login);
  const inApp = userState?.approvedAt ?? null;
  const commit = userState?.approvedCommitOid ?? null;
  const onGitHub = viewer !== null && commit !== null && pr.reviews.some((review) => isVerdict(review) && sameLogin(review.author, viewer.login) && review.commitOid === commit);
  if (inApp !== null && !onGitHub && (newest === null || inApp >= newest.submittedAt)) {
    return true;
  }
  return newest?.state === 'APPROVED';
}

/** The viewer's newest sent, not dismissed review of the head commit, or null. */
export function viewerHeadReview(pr: Pr, viewer: Viewer): Review | null {
  let newest: Review | null = null;
  for (const review of pr.reviews) {
    const counts = sameLogin(review.author, viewer.login) && review.state !== 'PENDING' && review.state !== 'DISMISSED' && review.commitOid === pr.headOid;
    if (counts && (newest === null || review.submittedAt >= newest.submittedAt)) {
      newest = review;
    }
  }
  return newest;
}

export function viewerReviewedHead(pr: Pr, viewer: Viewer, userState: UserPrState | null): boolean {
  return viewerHeadReview(pr, viewer) !== null || viewerApproved(pr, viewer, userState);
}

// ---------------------------------------------------------------------------
// Review requests
// ---------------------------------------------------------------------------

/** The subject a review request event names, looked up on the timeline item it came from. */
export function requestSubjectOf(pr: Pr, event: { kind: string; sourceId: string }): string | null {
  if (event.kind !== 'review_requested' && event.kind !== 'review_request_removed') {
    return null;
  }
  return pr.timeline.find((item) => item.id === event.sourceId)?.subject ?? null;
}

/** The viewer or their team was asked at some point: pending now, or in the timeline. */
export function viewerWasAsked(pr: Pr, viewer: Viewer): boolean {
  const pending = [...pr.reviewerUsers, ...pr.reviewerTeams].some((subject) => asksViewer(viewer, subject));
  return pending || pr.timeline.some((item) => item.kind === 'review_requested' && asksViewer(viewer, item.subject));
}

/**
 * Teammates who picked up a team request: a sent review by a human who is
 * not the viewer or the author and is on the team (anyone while the list
 * is unknown). On a teammate's PR only an approval or a changes request.
 */
export function teamTakers(pr: Pr, viewer: Viewer): string[] {
  const teammatesPr = isKnownTeammate(viewer, pr.author);
  const takers: string[] = [];
  for (const review of pr.reviews) {
    const who = review.author;
    if (review.state === 'PENDING' || sameLogin(who, viewer.login) || sameLogin(who, pr.author) || isAutomationLogin(who)) {
      continue;
    }
    if (viewer.teamMembers !== undefined && !isKnownTeammate(viewer, who)) {
      continue;
    }
    if (teammatesPr && review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED') {
      continue;
    }
    if (!takers.some((login) => sameLogin(login, who))) {
      takers.push(who);
    }
  }
  return takers;
}

export type SpecRequest = 'you' | 'team_for_you' | 'team' | 'team_taken' | null;

/** The pending request that concerns the viewer: personal, their team on a teammate's PR, routed, or taken. */
export function pendingRequest(pr: Pr, viewer: Viewer): SpecRequest {
  if (pr.reviewerUsers.some((login) => sameLogin(login, viewer.login))) {
    return 'you';
  }
  if (!pr.reviewerTeams.some((team) => isViewerTeam(viewer, team))) {
    return null;
  }
  if (teamTakers(pr, viewer).length > 0) {
    return 'team_taken';
  }
  return isKnownTeammate(viewer, pr.author) ? 'team_for_you' : 'team';
}

/** A routed team request waits: the glance says not yours, or someone else's changes request stands. */
export function routedRequestWaits(pr: Pr, viewer: Viewer, notYours: boolean): 'not_yours' | 'changes' | null {
  if (pendingRequest(pr, viewer) !== 'team') {
    return null;
  }
  if (notYours) {
    return 'not_yours';
  }
  return standingChangesBy(pr).some((login) => !sameLogin(login, viewer.login)) ? 'changes' : null;
}

/** A review is still owed: an open non-draft PR by someone else, a request that asks now, and no review of the head. */
export function reviewStillOwed(pr: Pr, viewer: Viewer, userState: UserPrState | null, notYours: boolean): boolean {
  if (pr.state !== 'OPEN' || pr.isDraft || sameLogin(pr.author, viewer.login)) {
    return false;
  }
  const request = pendingRequest(pr, viewer);
  if (request === null || request === 'team_taken' || routedRequestWaits(pr, viewer, notYours) !== null) {
    return false;
  }
  return !viewerReviewedHead(pr, viewer, userState);
}

// ---------------------------------------------------------------------------
// Speaking, pushing, touching
// ---------------------------------------------------------------------------

/** When `login` last spoke: newest comment (any kind) or sent review; reviews only when asked. */
export function lastSpoke(pr: Pr, login: string, reviewsOnly = false): IsoTime | null {
  const reviews = pr.reviews.filter((review) => review.state !== 'PENDING' && sameLogin(review.author, login)).map((review) => review.submittedAt);
  const comments = reviewsOnly ? [] : pr.comments.filter((comment) => sameLogin(comment.author, login)).map((comment) => comment.createdAt);
  return [...reviews, ...comments].sort().at(-1) ?? null;
}

function spokeAfter(pr: Pr, login: string, at: IsoTime, reviewsOnly = false): boolean {
  const spoke = lastSpoke(pr, login, reviewsOnly);
  return spoke !== null && spoke > at;
}

/** A human other than `reviewer` pushed a commit or force-pushed after `since`. */
export function someonePushedAfter(pr: Pr, reviewer: string, since: IsoTime): boolean {
  const pusher = (login: string) => !isAutomationLogin(login) && !sameLogin(login, reviewer);
  const commit = pr.commits.some((c) => c.committedAt > since && pusher(c.author));
  const force = pr.timeline.some((item) => item.kind === 'head_ref_force_pushed' && item.at > since && pusher(item.actor));
  return commit || force;
}

export interface SpecChangesAnswer {
  since: IsoTime;
  pushed: boolean;
  replied: boolean;
}

/**
 * The author answered the viewer's changes request: open, not a draft,
 * someone else's PR, the viewer's newest verdict asks for changes, and
 * after the viewer's last word a human pushed or the author spoke.
 */
export function changesAnswer(pr: Pr, viewer: Viewer): SpecChangesAnswer | null {
  if (pr.state !== 'OPEN' || pr.isDraft || !viewerAskedForChanges(pr, viewer)) {
    return null;
  }
  const since = lastSpoke(pr, viewer.login)!;
  const pushed = someonePushedAfter(pr, viewer.login, since);
  const replied = spokeAfter(pr, pr.author, since);
  return pushed || replied ? { since, pushed, replied } : null;
}

/** Asked to re-review: still asks for changes, pending as a reviewer again, and a human pushed after the verdict. */
export function askedToReReview(pr: Pr, reviewer: string): boolean {
  if (pr.state !== 'OPEN' || !pr.reviewerUsers.some((login) => sameLogin(login, reviewer))) {
    return false;
  }
  const verdict = newestVerdict(pr, reviewer);
  return verdict?.state === 'CHANGES_REQUESTED' && someonePushedAfter(pr, reviewer, verdict.submittedAt);
}

/** Who has the last word in each unresolved thread that waits on the viewer: someone other than the viewer or automation. */
export function threadsWaitingOnViewer(pr: Pr, viewer: Viewer): string[] {
  const lastWords: string[] = [];
  for (const thread of pr.threads) {
    const last = thread.comments.at(-1);
    if (!thread.isResolved && last !== undefined && !sameLogin(last.author, viewer.login) && !isAutomationLogin(last.author)) {
      lastWords.push(last.author);
    }
  }
  return lastWords;
}

/** Unresolved threads the viewer started. */
export function threadsViewerOpened(pr: Pr, viewer: Viewer): number {
  return pr.threads.filter((thread) => !thread.isResolved && thread.comments[0] !== undefined && sameLogin(thread.comments[0].author, viewer.login)).length;
}

export type SpecTouchKind = 'changes_request' | 'approval' | 'review' | 'comment' | 'push' | 'merge' | 'close';

export interface SpecTouch {
  kind: SpecTouchKind;
  at: IsoTime;
  /** The event id the touch is, so two touches at one instant order like the stored events. */
  id: string;
}

const REVIEW_TOUCH: Partial<Record<Review['state'], { kind: SpecTouchKind; event: string }>> = {
  APPROVED: { kind: 'approval', event: 'review_approved' },
  CHANGES_REQUESTED: { kind: 'changes_request', event: 'review_changes_requested' },
  COMMENTED: { kind: 'review', event: 'review_commented' },
};

function endTouch(pr: Pr, item: TimelineItem, viewer: Viewer): SpecTouch | null {
  if (!isViewerLogin(viewer, item.actor)) {
    return null;
  }
  if (item.kind === 'merged') {
    return { kind: 'merge', at: item.at, id: `${pr.key}:merged:${item.id}` };
  }
  return item.kind === 'closed' ? { kind: 'close', at: item.at, id: `${pr.key}:closed:${item.id}` } : null;
}

/**
 * Everything the viewer did on the PR, from the snapshot: their sent
 * reviews (a dismissed one is no event), their comments that are not
 * automated, and on their own PR the commits they committed and their
 * force pushes, and merging or closing it.
 */
export function viewerTouches(pr: Pr, viewer: Viewer): SpecTouch[] {
  const touches: SpecTouch[] = [];
  for (const review of pr.reviews) {
    const touch = REVIEW_TOUCH[review.state];
    if (touch && sameLogin(review.author, viewer.login)) {
      touches.push({ kind: touch.kind, at: review.submittedAt, id: `${pr.key}:${touch.event}:${review.id}` });
    }
  }
  for (const comment of pr.comments) {
    if (sameLogin(comment.author, viewer.login) && !isMachineComment(comment)) {
      touches.push({ kind: 'comment', at: comment.createdAt, id: `${pr.key}:comment:${comment.id}` });
    }
  }
  if (sameLogin(pr.author, viewer.login)) {
    for (const commit of pr.commits) {
      if (commit.committer !== undefined && sameLogin(commit.committer, viewer.login)) {
        touches.push({ kind: 'push', at: commit.committedAt, id: `${pr.key}:commits_pushed:${commit.oid}` });
      }
    }
    for (const item of pr.timeline) {
      if (item.kind === 'head_ref_force_pushed' && isViewerLogin(viewer, item.actor)) {
        touches.push({ kind: 'push', at: item.at, id: `${pr.key}:force_pushed:${item.id}` });
      }
    }
  }
  for (const item of pr.timeline) {
    const touch = endTouch(pr, item, viewer);
    if (touch) {
      touches.push(touch);
    }
  }
  return touches;
}

/** A review or a comment: what says the viewer read what came before. */
export const READING_TOUCHES: readonly SpecTouchKind[] = ['changes_request', 'approval', 'review', 'comment'];

/** The viewer's newest touch (of `kinds`), the later event on a tie, or null. */
export function newestTouch(pr: Pr, viewer: Viewer, kinds: readonly SpecTouchKind[] | null = null): SpecTouch | null {
  const touches = viewerTouches(pr, viewer).filter((touch) => kinds === null || kinds.includes(touch.kind));
  return touches.toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).at(-1) ?? null;
}
