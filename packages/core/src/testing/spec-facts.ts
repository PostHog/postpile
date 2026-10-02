// PR facts restated from the raw snapshot, for the generated world only
// (testing/build-board.ts): who is automation, who is on the team, what a
// comment says, reviews and approvals, review requests, the viewer's
// touches, and the owner's answer to a changes request. The spec oracles
// build on these instead of calling the rule under test, so a mutated rule
// can never move both sides of a check. Nothing here imports a rule module;
// only `sameLogin` and the builder's names are shared.
import { sameLogin } from '../mentions.ts';
import type { Comment, IsoTime, Pr, PrEvent, Review, TimelineItem, UserPrState, Viewer } from '../types.ts';
import type { CommentText, TrunkText } from './board-spec.ts';
import { AUTOMATION_LOGINS, COMMENT_BODIES, MENTIONED_TEAMS, TRUNK_BODIES, TRUNK_LOGIN } from './build-board.ts';

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** A bot account or no actor at all (a CI result). */
export function isAutomationLogin(login: string): boolean {
  return login === '' || AUTOMATION_LOGINS.some((bot) => sameLogin(bot, login));
}

/**
 * Whose PR it is (DESIGN "PR ownership"): the author, or the assignees of a
 * PR a bot opened. A deleted author ('') stays the owner.
 */
export function specOwners(pr: Pr): string[] {
  const assignees = pr.assignees ?? [];
  return pr.author !== '' && isAutomationLogin(pr.author) && assignees.length > 0 ? assignees : [pr.author];
}

export function isViewerLogin(viewer: Viewer, login: string): boolean {
  return login !== '' && sameLogin(login, viewer.login);
}

/** `login` is one of the PR's owners (`specOwners`). */
export function isOwner(pr: Pr, login: string): boolean {
  return specOwners(pr).some((owner) => sameLogin(owner, login));
}

/** The owner a sentence names ("lyra to merge"): the first one. */
export function namedOwner(pr: Pr): string {
  return specOwners(pr)[0]!;
}

/** The viewer's own PR: they wrote it, or a bot opened it and assigned them. */
export function viewerOwns(pr: Pr, viewer: Viewer): boolean {
  return specOwners(pr).some((owner) => isViewerLogin(viewer, owner));
}

/**
 * On one of the viewer's home teams by the fetched member list (the engine
 * fetches only home teams' members); nobody is while the list is unknown.
 */
export function isKnownTeammate(viewer: Viewer, login: string): boolean {
  return (viewer.teamMembers ?? []).some((member) => sameLogin(member, login));
}

/** A teammate's PR: a known teammate is one of its owners. */
export function teammateOwns(pr: Pr, viewer: Viewer): boolean {
  return specOwners(pr).some((owner) => isKnownTeammate(viewer, owner));
}

/** How a person relates to the viewer: the viewer, a known teammate, anyone else. */
export function specRelation(login: string, viewer: Viewer): 'you' | 'team' | 'other' {
  if (isViewerLogin(viewer, login)) {
    return 'you';
  }
  return isKnownTeammate(viewer, login) ? 'team' : 'other';
}

/** How the PR's owners relate to the viewer: theirs, else a teammate's, else someone else's. */
export function specOwnerRelation(pr: Pr, viewer: Viewer): 'you' | 'team' | 'other' {
  if (viewerOwns(pr, viewer)) {
    return 'you';
  }
  return teammateOwns(pr, viewer) ? 'team' : 'other';
}

/** A review request subject that is the viewer or one of their teams. */
export function asksViewer(viewer: Viewer, subject: string | null): boolean {
  if (subject === null) {
    return false;
  }
  return sameLogin(subject, viewer.login) || viewer.teams.some((team) => sameLogin(team, subject));
}

/** A request subject that is one of the viewer's teams (not the viewer), home or routing. */
export function isViewerTeam(viewer: Viewer, subject: string | null): boolean {
  return subject !== null && viewer.teams.some((team) => sameLogin(team, subject));
}

/** One of the viewer's home teams (DESIGN "Team roles"): every team of theirs while `homeTeams` is missing. */
export function isHomeTeam(viewer: Viewer, team: string): boolean {
  const home = viewer.homeTeams ?? viewer.teams;
  return home.some((candidate) => sameLogin(candidate, team));
}

/** One of the viewer's teams that only routes review requests and mentions to them. */
export function isRoutingTeam(viewer: Viewer, team: string): boolean {
  return isViewerTeam(viewer, team) && !isHomeTeam(viewer, team);
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

/** The viewer's teams the body @-mentions, in the order the body names them. */
export function viewerTeamsMentioned(body: string, viewer: Viewer): string[] {
  const text = commentText(body);
  return text === null ? [] : MENTIONED_TEAMS[text].filter((team) => isViewerTeam(viewer, team));
}

export function mentionsViewerTeam(body: string, viewer: Viewer): boolean {
  return viewerTeamsMentioned(body, viewer).length > 0;
}

/** The mention names only teams that route reviews to the viewer, none of their home teams: FYI. */
export function mentionsOnlyRoutingTeams(body: string, viewer: Viewer): boolean {
  const teams = viewerTeamsMentioned(body, viewer);
  return teams.length > 0 && teams.every((team) => isRoutingTeam(viewer, team));
}

/** Automation wrote it: a bot account, or a body that says it is automated. */
export function isMachineComment(comment: Pick<Comment, 'author' | 'body'>): boolean {
  return isAutomationLogin(comment.author) || commentText(comment.body) === 'bot_marker';
}

export function saysDeploy(body: string): boolean {
  return commentText(body) === 'deploy';
}

// ---------------------------------------------------------------------------
// The merge queue (DESIGN "Merge queue"; the builder writes one body per TrunkText)
// ---------------------------------------------------------------------------

/** A step in Trunk's queue as the spec reads it, and when trunk said it. */
export interface SpecQueueStep {
  state: 'submitted' | 'testing' | 'failed';
  /** failed: why ("tests failed"), null when trunk gives none; null for the other steps. */
  reason: string | null;
  at: IsoTime;
}

/**
 * What each trunk body says: a step, or nothing (the offer, cancelled by a
 * user, merged, a line nobody knows). A stack testing reads as testing; a
 * ❌ line in words nobody knows is failed, with no reason to give.
 */
const TRUNK_STEPS: Record<TrunkText, Omit<SpecQueueStep, 'at'> | null> = {
  offer: null,
  submitted: { state: 'submitted', reason: null },
  testing: { state: 'testing', reason: null },
  stack_testing: { state: 'testing', reason: null },
  failed: { state: 'failed', reason: 'tests failed' },
  emoji_failed: { state: 'failed', reason: null },
  cancelled: null,
  merged: null,
  garbage: null,
};

/** Each trunk comment at its last edit (else when posted), oldest first, with what it says; a body the builder never wrote for trunk says nothing. */
function trunkStatuses(pr: Pr): { at: IsoTime; step: Omit<SpecQueueStep, 'at'> | null }[] {
  return pr.comments
    .filter((comment) => sameLogin(comment.author, TRUNK_LOGIN))
    .map((comment) => {
      const text = (Object.entries(TRUNK_BODIES) as [TrunkText, string][]).find(([, body]) => body === comment.body)?.[0];
      return { at: comment.lastEditedAt ?? comment.createdAt, step: text === undefined ? null : TRUNK_STEPS[text] };
    })
    .toSorted((a, b) => a.at.localeCompare(b.at));
}

/** Where an open PR stands in Trunk's queue: what trunk's newest comment says. */
export function specMergeQueue(pr: Pr): SpecQueueStep | null {
  const newest = trunkStatuses(pr).at(-1);
  return pr.state === 'OPEN' && !pr.isDraft && newest?.step ? { ...newest.step, at: newest.at } : null;
}

/** Trunk's comment or edit at `at` took the PR from anything else to failed, and it is failed still. */
export function specQueueFailedAt(pr: Pr, at: IsoTime): SpecQueueStep | null {
  if (specMergeQueue(pr)?.state !== 'failed') {
    return null;
  }
  const statuses = trunkStatuses(pr);
  const then = statuses.filter((status) => status.at <= at).at(-1);
  const before = statuses.filter((status) => status.at < at).at(-1);
  if (then?.at !== at || then.step?.state !== 'failed' || before?.step?.state === 'failed') {
    return null;
  }
  return { ...then.step, at };
}

/** In GitHub's own merge queue: the newest queue entry on the timeline is an add. */
export function inGitHubQueue(pr: Pr): boolean {
  const entries = pr.timeline.filter((item) => item.kind === 'added_to_merge_queue' || item.kind === 'removed_from_merge_queue');
  return entries.at(-1)?.kind === 'added_to_merge_queue';
}

/** The PR's state icon: merged, closed and drafts as they are; an open PR failed in Trunk's queue red, in either queue amber, else open. */
export function specPrIcon(pr: Pr): string {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  if (pr.isDraft) {
    return 'draft';
  }
  const queue = specMergeQueue(pr);
  if (queue?.state === 'failed') {
    return 'merge_queue_failed';
  }
  return queue !== null || inGitHubQueue(pr) ? 'merge_queue' : 'open';
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

/** The viewer's newest verdict on a PR someone else owns asks for changes (on their own bot PR a review of theirs is no open loop). */
export function viewerAskedForChanges(pr: Pr, viewer: Viewer): boolean {
  return !viewerOwns(pr, viewer) && newestVerdict(pr, viewer.login)?.state === 'CHANGES_REQUESTED';
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

/** A review request event naming the viewer or one of their teams, whoever made it. */
export function isViewerRequestEvent(pr: Pr, viewer: Viewer, event: PrEvent): boolean {
  return event.kind === 'review_requested' && asksViewer(viewer, requestSubjectOf(pr, event));
}

/** When the newest review request of the viewer or one of their teams came, null when none did. */
export function latestViewerRequestAt(pr: Pr, viewer: Viewer, events: PrEvent[]): IsoTime | null {
  return events.filter((event) => isViewerRequestEvent(pr, viewer, event)).map((event) => event.at).toSorted().at(-1) ?? null;
}

/** The viewer or their team was asked at some point: pending now, or in the timeline. */
export function viewerWasAsked(pr: Pr, viewer: Viewer): boolean {
  const pending = [...pr.reviewerUsers, ...pr.reviewerTeams].some((subject) => asksViewer(viewer, subject));
  return pending || pr.timeline.some((item) => item.kind === 'review_requested' && asksViewer(viewer, item.subject));
}

/**
 * Teammates who picked up a home team's request: a sent review by a human
 * who is not the viewer or an owner and is on a home team (anyone while
 * the list is unknown). On a teammate's PR only an approval or a changes
 * request.
 */
function homeTeamTakers(pr: Pr, viewer: Viewer, since: IsoTime | null = null): string[] {
  const teammatesPr = teammateOwns(pr, viewer);
  const takers: string[] = [];
  for (const review of pr.reviews) {
    const who = review.author;
    if (review.state === 'PENDING' || sameLogin(who, viewer.login) || isOwner(pr, who) || isAutomationLogin(who)) {
      continue;
    }
    if (since !== null && review.submittedAt <= since) {
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

/**
 * Who took a routing team's request: anyone who sent a review of the head
 * (not dismissed) other than the viewer, the author, the owners and
 * automation. Its members are not known, so anyone counts.
 */
function headReviewers(pr: Pr, viewer: Viewer, since: IsoTime | null = null): string[] {
  const takers: string[] = [];
  for (const review of pr.reviews) {
    const who = review.author;
    const sent = review.state !== 'PENDING' && review.state !== 'DISMISSED' && review.commitOid === pr.headOid && (since === null || review.submittedAt > since);
    const someoneElse = !sameLogin(who, viewer.login) && !sameLogin(who, pr.author) && !isOwner(pr, who) && !isAutomationLogin(who);
    if (sent && someoneElse && !takers.some((login) => sameLogin(login, who))) {
      takers.push(who);
    }
  }
  return takers;
}

function homeTeamPending(pr: Pr, viewer: Viewer): boolean {
  return pr.reviewerTeams.some((team) => isViewerTeam(viewer, team) && isHomeTeam(viewer, team));
}

function routingTeamPending(pr: Pr, viewer: Viewer): boolean {
  return pr.reviewerTeams.some((team) => isRoutingTeam(viewer, team));
}

/** Who picked up the viewer's pending team requests: teammates for a home team, anyone who reviewed the head for a routing team. */
export function teamTakers(pr: Pr, viewer: Viewer, since: IsoTime | null = null): string[] {
  const takers = homeTeamPending(pr, viewer) ? homeTeamTakers(pr, viewer, since) : [];
  for (const who of routingTeamPending(pr, viewer) ? headReviewers(pr, viewer, since) : []) {
    if (!takers.some((login) => sameLogin(login, who))) {
      takers.push(who);
    }
  }
  return takers;
}

export type SpecRequest = 'you' | 'team_for_you' | 'team' | 'team_taken' | null;

/** A home team's pending request: for you on a teammate's PR, routed on anyone else's, taken once a teammate picked it up. */
function homeTeamRequest(pr: Pr, viewer: Viewer): SpecRequest {
  if (!homeTeamPending(pr, viewer)) {
    return null;
  }
  if (homeTeamTakers(pr, viewer).length > 0) {
    return 'team_taken';
  }
  return teammateOwns(pr, viewer) ? 'team_for_you' : 'team';
}

/** A routing team's pending request: routed on any PR, a teammate's too, taken once anyone else reviewed the head. */
function routingTeamRequest(pr: Pr, viewer: Viewer): SpecRequest {
  if (!routingTeamPending(pr, viewer)) {
    return null;
  }
  return headReviewers(pr, viewer).length > 0 ? 'team_taken' : 'team';
}

/** How much a team request still asks: for you, then routed, then taken. */
const OWED: readonly SpecRequest[] = ['team_for_you', 'team', 'team_taken'];

/** Both kinds pending: the one that asks more decides, the home team's on a tie. */
function routingDecides(pr: Pr, viewer: Viewer): boolean {
  const home = homeTeamRequest(pr, viewer);
  const routing = routingTeamRequest(pr, viewer);
  return routing !== null && (home === null || OWED.indexOf(routing) < OWED.indexOf(home));
}

/** The pending request that concerns the viewer: personal, their home team on a teammate's PR, routed, or taken. */
export function pendingRequest(pr: Pr, viewer: Viewer): SpecRequest {
  if (pr.reviewerUsers.some((login) => sameLogin(login, viewer.login))) {
    return 'you';
  }
  return routingDecides(pr, viewer) ? routingTeamRequest(pr, viewer) : homeTeamRequest(pr, viewer);
}

/** The team the pending team request is for: the routing team when its request decides, else the home team. */
export function pendingRequestTeam(pr: Pr, viewer: Viewer): string | null {
  const routing = routingDecides(pr, viewer);
  return pr.reviewerTeams.find((team) => isViewerTeam(viewer, team) && isRoutingTeam(viewer, team) === routing) ?? null;
}

/**
 * A request for this team on this PR is routed (DESIGN "Team roles",
 * "Live poll and Mac pings"): never on the viewer's own PR; a routing
 * team's on anyone else's; a home team's on a PR from outside the team.
 */
export function isRoutedTeam(pr: Pr, viewer: Viewer, team: string): boolean {
  if (!isViewerTeam(viewer, team) || viewerOwns(pr, viewer)) {
    return false;
  }
  return isRoutingTeam(viewer, team) || !teammateOwns(pr, viewer);
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

/** A review is still owed: an open non-draft PR someone else owns, a request that asks now, and no review of the head. */
export function reviewStillOwed(pr: Pr, viewer: Viewer, userState: UserPrState | null, notYours: boolean): boolean {
  if (pr.state !== 'OPEN' || pr.isDraft || viewerOwns(pr, viewer)) {
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
 * The owner answered the viewer's changes request: open, not a draft,
 * someone else's PR, the viewer's newest verdict asks for changes, and
 * after the viewer's last word a human pushed or an owner spoke.
 */
export function changesAnswer(pr: Pr, viewer: Viewer): SpecChangesAnswer | null {
  if (pr.state !== 'OPEN' || pr.isDraft || !viewerAskedForChanges(pr, viewer)) {
    return null;
  }
  const since = lastSpoke(pr, viewer.login)!;
  const pushed = someonePushedAfter(pr, viewer.login, since);
  const replied = specOwners(pr).some((owner) => spokeAfter(pr, owner, since));
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
 * automated, and on a PR they own the commits they committed and their
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
  if (viewerOwns(pr, viewer)) {
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

// ---------------------------------------------------------------------------
// The PR as it stood earlier (DESIGN "Handled quietly" › New moves only)
// ---------------------------------------------------------------------------

/** GitHub's decision from the standing verdicts: changes first, then an approval, else review required. */
function decisionOfVerdicts(pr: Pr): Pr['reviewDecision'] {
  if (standingChangesBy(pr).length > 0) {
    return 'CHANGES_REQUESTED';
  }
  const authors = [...new Set(pr.reviews.map((review) => review.author.toLowerCase()))];
  return authors.some((login) => newestVerdict(pr, login)?.state === 'APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED';
}

/**
 * The pending requests at `at`, replayed forward from the PR's start (the
 * generated world keeps every request in the timeline): a request adds its
 * subject, a removal takes it off, a sent review takes the reviewer off.
 */
function requestsReplayedTo(pr: Pr, at: IsoTime): string[] {
  const steps: { at: IsoTime; add: boolean; subject: string }[] = [];
  for (const item of pr.timeline) {
    if (item.at <= at && item.subject !== null && (item.kind === 'review_requested' || item.kind === 'review_request_removed')) {
      steps.push({ at: item.at, add: item.kind === 'review_requested', subject: item.subject });
    }
  }
  for (const review of pr.reviews) {
    if (review.submittedAt <= at && review.state !== 'PENDING') {
      steps.push({ at: review.submittedAt, add: false, subject: review.author });
    }
  }
  let pending: string[] = [];
  for (const step of steps.toSorted((a, b) => a.at.localeCompare(b.at))) {
    pending = pending.filter((subject) => !sameLogin(subject, step.subject));
    if (step.add) {
      pending.push(step.subject);
    }
  }
  return pending;
}

/** Open, merged or closed at `at`: the last merge, close or reopen by then (every generated PR starts open). */
function stateReplayedTo(pr: Pr, at: IsoTime): Pr['state'] {
  const last = pr.timeline.filter((item) => item.at <= at && (item.kind === 'merged' || item.kind === 'closed' || item.kind === 'reopened')).toSorted((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (last?.kind === 'merged') {
    return 'MERGED';
  }
  return last?.kind === 'closed' ? 'CLOSED' : 'OPEN';
}

/**
 * The snapshot at `at`, as the history says it was: reviews, comments and
 * thread comments, commits with the head and timeline items up to it, the
 * requests and the state replayed up to it, the draft state before the
 * first switch after it. The decision is worked out again only when a
 * review came after it, and never where GitHub has no review rule.
 */
export function specSnapshotAt(pr: Pr, at: IsoTime): Pr {
  const pending = requestsReplayedTo(pr, at);
  const state = stateReplayedTo(pr, at);
  const firstSwitch = pr.timeline.filter((item) => (item.kind === 'ready_for_review' || item.kind === 'converted_to_draft') && item.at > at).toSorted((a, b) => a.at.localeCompare(b.at))[0];
  const commits = pr.commits.filter((commit) => commit.committedAt <= at);
  const trimmed: Pr = {
    ...pr,
    state,
    mergedAt: state === 'MERGED' ? pr.mergedAt : null,
    mergedBy: state === 'MERGED' ? pr.mergedBy : null,
    isDraft: firstSwitch === undefined ? pr.isDraft : firstSwitch.kind === 'ready_for_review',
    reviewerUsers: pending.filter((subject) => !subject.includes('/')),
    reviewerTeams: pending.filter((subject) => subject.includes('/')),
    reviews: pr.reviews.filter((review) => review.submittedAt <= at),
    commits,
    headOid: commits.length > 0 ? commits[commits.length - 1]!.oid : pr.headOid,
    comments: pr.comments.filter((comment) => comment.createdAt <= at),
    threads: pr.threads.map((thread) => ({ ...thread, comments: thread.comments.filter((comment) => comment.createdAt <= at) })).filter((thread) => thread.comments.length > 0),
    timeline: pr.timeline.filter((item) => item.at <= at),
  };
  const reviewCameAfter = trimmed.reviews.length < pr.reviews.length;
  return { ...trimmed, reviewDecision: reviewCameAfter && pr.reviewDecision !== 'NONE' ? decisionOfVerdicts(trimmed) : pr.reviewDecision };
}

/** The in-app approval as it stood at `at`. */
export function specUserStateAt(userState: UserPrState | null, at: IsoTime): UserPrState | null {
  return userState?.approvedAt && userState.approvedAt > at ? { ...userState, approvedAt: null, approvedCommitOid: null } : userState;
}
