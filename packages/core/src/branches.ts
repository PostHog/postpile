// PR signals for session-first tools (`pnpm cli branches`): one entry per PR
// the viewer owns or reviewed, keyed so a tool that links git worktrees and
// agent sessions to PRs can join on repo + head branch (own PRs) or its own
// record of a review session (reviewed PRs). Rules only, from the stored
// snapshot: no GitHub call, no agent call. Each signal reuses the rule the
// app already has for it (whose move, standing changes, waiting threads,
// stamphog's verdict, stack holds, commits after a review).
import { agentVerdictView, type AgentDeclineKind } from './agent-decline.ts';
import { commitsAfter, standingApprovals, type ReviewPoint } from './approvals.ts';
import { isBotTalk } from './bot-talk.ts';
import { standingChanges } from './changes-answered.ts';
import { changesRequestedByAll, newestVerdictBy } from './review-request.ts';
import { lastSpokeAt } from './last-touch.ts';
import { sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { layerHold } from './stack-readiness.ts';
import type { IsoTime, Pr, PrEvent, PrKey, Review, ReviewState, UserPrState, Viewer } from './types.ts';
import { waitingThreads } from './waiting-threads.ts';
import { prWhoseTurn, type WhoseTurnKind, type YourMove } from './whose-turn.ts';

/** How many days of merged and closed PRs `branches` lists by default. */
export const BRANCHES_DEFAULT_DAYS = 7;

export type BranchRole = 'author' | 'reviewer';

/** A standing change request on the viewer's own PR. */
export interface BranchChangeRequest {
  by: string;
  at: IsoTime;
}

/** stamphog's standing decline (`agentVerdictView`). */
export interface BranchBotDecline {
  agent: string;
  kind: AgentDeclineKind;
  at: IsoTime;
  /** The verdict was made on a commit that is no longer the head. */
  olderHead: boolean;
  failedGates: string[];
  untrusted: { reason: string };
}

/** What waits on the viewer on their own PR; null on the entry when nothing does. */
export interface BranchFeedback {
  changesRequested: BranchChangeRequest[];
  /** `standingChanges`: address (the author moves) or re_review (every reviewer was asked again); null without a request. */
  changesNext: 'address' | 're_review' | null;
  /** Unresolved threads whose last word waits on the viewer (`waitingThreads`). */
  unansweredThreads: number;
  /** The newest of them; its text stays out (GitHub text). */
  newestUnansweredThread: { author: string; at: IsoTime; path: string; url: string } | null;
  botDecline: BranchBotDecline | null;
}

export interface BranchPushes {
  reviewedAt: IsoTime;
  reviewState: ReviewState;
  reviewCommitOid: string | null;
  commitsSince: number;
}

export interface BranchReplies {
  /** The viewer's last review or comment on the PR. */
  since: IsoTime;
  count: number;
}

export interface BranchSignals {
  /** Role author only; null when nothing waits. */
  feedback: BranchFeedback | null;
  /** Role author only; false on a reviewer's entry. */
  readyToLand: boolean;
  ended: { state: 'merged' | 'closed'; at: IsoTime } | null;
  /** Role reviewer only; null when nothing was pushed since the viewer's review. */
  pushesSinceYourReview: BranchPushes | null;
  /** Role reviewer only; null when nobody replied since the viewer last spoke. */
  repliesSinceYourReview: BranchReplies | null;
}

export interface BranchEntry {
  key: PrKey;
  /** "owner/name", as in a git remote. */
  repo: string;
  number: number;
  url: string;
  headRef: string;
  baseRef: string;
  headOid: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  mergedAt: IsoTime | null;
  closedAt: IsoTime | null;
  author: string;
  role: BranchRole;
  whoseMove: { kind: WhoseTurnKind; move: YourMove | null; who: string | null; what: string };
  fetchedAt: IsoTime | null;
  untrusted: { title: string };
  signals: BranchSignals;
}

export interface BranchesView {
  generatedAt: IsoTime;
  viewer: string;
  prs: BranchEntry[];
}

/** One stored PR with what the rules read next to it. */
export interface BranchInput {
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  fetchedAt: IsoTime | null;
}

export interface BranchesOptions {
  /** Merged and closed PRs of the last n days; open ones always. */
  days: number;
  /** "owner/name"; null for every repo. */
  repo: string | null;
}

/** When a closed PR was closed: its newest "closed" timeline item, else its last update. Null on an open or merged PR. */
function closedAt(pr: Pr): IsoTime | null {
  if (pr.state !== 'CLOSED') {
    return null;
  }
  const closes = pr.timeline.filter((item) => item.kind === 'closed').map((item) => item.at);
  return closes.sort().at(-1) ?? pr.updatedAt;
}

/** When the PR ended (merged or closed), null while it is open. */
function endedAt(pr: Pr): IsoTime | null {
  if (pr.state === 'MERGED') {
    return pr.mergedAt ?? pr.updatedAt;
  }
  return closedAt(pr);
}

/** Open, or merged or closed at or after `since`. */
export function inBranchWindow(pr: Pr, since: IsoTime): boolean {
  const ended = endedAt(pr);
  return ended === null || ended >= since;
}

/** The viewer's newest submitted review of any kind (approve, changes requested, comment, dismissed), or null. */
export function viewerLatestReview(pr: Pr, login: string): Review | null {
  let newest: Review | null = null;
  for (const review of pr.reviews) {
    if (review.state === 'PENDING' || !sameLogin(review.author, login)) {
      continue;
    }
    if (newest === null || review.submittedAt > newest.submittedAt) {
      newest = review;
    }
  }
  return newest;
}

/** author when the viewer owns the PR (`isPrOwner`), reviewer when they reviewed it, else null. */
export function branchRole(pr: Pr, login: string): BranchRole | null {
  if (isPrOwner(pr, login)) {
    return 'author';
  }
  return viewerLatestReview(pr, login) === null ? null : 'reviewer';
}

/**
 * Commits pushed after the viewer's newest review (`commitsAfter`, the same
 * count as "commits after approval"): after its commit in the PR's commit
 * list, else, when that commit is gone after a force push, committed after
 * the review. Agents that review as the viewer count as the viewer. Null
 * when the viewer never reviewed or nothing was pushed since, like
 * `feedback` is null when nothing waits.
 */
export function pushesSinceYourReview(pr: Pr, login: string): BranchPushes | null {
  const review = viewerLatestReview(pr, login);
  if (review === null) {
    return null;
  }
  const point: ReviewPoint = { at: review.submittedAt, commitOid: review.commitOid };
  const commitsSince = commitsAfter(pr, point).size;
  if (commitsSince === 0) {
    return null;
  }
  return { reviewedAt: review.submittedAt, reviewState: review.state, reviewCommitOid: review.commitOid, commitsSince };
}

/** Review threads the viewer wrote in. */
function viewerThreadIds(pr: Pr, login: string): Set<string> {
  const ids = pr.threads.filter((thread) => thread.comments.some((comment) => sameLogin(comment.author, login))).map((thread) => thread.id);
  return new Set(ids);
}

/**
 * Comments by others after the viewer last spoke on the PR (`lastSpokeAt`:
 * their newest review or comment): conversation comments, and replies in
 * review threads the viewer wrote in. Bot talk (`isBotTalk`) and review
 * bodies never count: a reviewer's own verdict is no reply to the viewer.
 * Null when the viewer never spoke or nobody replied since.
 */
export function repliesSinceYourReview(pr: Pr, login: string): BranchReplies | null {
  const since = lastSpokeAt(pr, login);
  if (since === null) {
    return null;
  }
  const ownThreads = viewerThreadIds(pr, login);
  const count = pr.comments.filter((comment) => {
    if (comment.createdAt <= since || sameLogin(comment.author, login) || isBotTalk(comment, pr)) {
      return false;
    }
    if (comment.kind === 'comment') {
      return true;
    }
    return comment.kind === 'review_comment' && comment.threadId !== null && ownThreads.has(comment.threadId);
  }).length;
  return count === 0 ? null : { since, count };
}

function botDecline(pr: Pr): BranchBotDecline | null {
  const verdict = agentVerdictView(pr);
  if (verdict === null || verdict.verdict !== 'declined' || verdict.declineKind === null) {
    return null;
  }
  return { agent: verdict.agent, kind: verdict.declineKind, at: verdict.at, olderHead: verdict.olderHead, failedGates: verdict.failedGates, untrusted: { reason: verdict.reason } };
}

/** What waits on the viewer on their own PR; null when nothing does. */
export function branchFeedback(pr: Pr, viewer: Viewer): BranchFeedback | null {
  const changesRequested = changesRequestedByAll(pr).map((by) => ({ by, at: newestVerdictBy(pr.reviews, by)?.submittedAt ?? pr.updatedAt }));
  const threads = waitingThreads(pr, viewer);
  const newest = threads[0];
  const decline = botDecline(pr);
  if (changesRequested.length === 0 && threads.length === 0 && decline === null) {
    return null;
  }
  return {
    changesRequested,
    changesNext: standingChanges(pr)?.kind ?? null,
    unansweredThreads: threads.length,
    newestUnansweredThread: newest ? { author: newest.author, at: newest.at, path: newest.path, url: newest.url } : null,
    botDecline: decline,
  };
}

/** Approved as GitHub says, or, where the repo asks for no review (NONE), any standing approval. */
function isApproved(pr: Pr): boolean {
  if (pr.reviewDecision === 'APPROVED') {
    return true;
  }
  if (pr.reviewDecision !== 'NONE') {
    return false;
  }
  const approvals = standingApprovals(pr);
  return approvals.people.length > 0 || approvals.agents.length > 0;
}

/**
 * The viewer's own open PR can land: approved, not a draft, nothing holds
 * it (`layerHold`: no standing change request, no failed merge queue) and
 * no thread waits on the viewer. Stack layers below are not looked at.
 */
export function readyToLand(pr: Pr, viewer: Viewer): boolean {
  if (pr.state !== 'OPEN' || pr.isDraft || !isApproved(pr)) {
    return false;
  }
  return layerHold(pr) === null && waitingThreads(pr, viewer).length === 0;
}

function entryState(pr: Pr): BranchEntry['state'] {
  return pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : 'closed';
}

function branchSignals(pr: Pr, viewer: Viewer, role: BranchRole): BranchSignals {
  const ended = endedAt(pr);
  const endedSignal = ended === null ? null : { state: pr.state === 'MERGED' ? ('merged' as const) : ('closed' as const), at: ended };
  if (role === 'author') {
    return { feedback: branchFeedback(pr, viewer), readyToLand: readyToLand(pr, viewer), ended: endedSignal, pushesSinceYourReview: null, repliesSinceYourReview: null };
  }
  return {
    feedback: null,
    readyToLand: false,
    ended: endedSignal,
    pushesSinceYourReview: pushesSinceYourReview(pr, viewer.login),
    repliesSinceYourReview: repliesSinceYourReview(pr, viewer.login),
  };
}

/** One PR's entry, null when the viewer neither owns nor reviewed it. */
export function branchEntry(input: BranchInput, viewer: Viewer): BranchEntry | null {
  const { pr } = input;
  const role = branchRole(pr, viewer.login);
  if (role === null) {
    return null;
  }
  const turn = prWhoseTurn({ pr, events: input.events, userState: input.userState, viewer });
  return {
    key: pr.key,
    repo: pr.ref.repo,
    number: pr.ref.number,
    url: pr.url,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headOid: pr.headOid,
    state: entryState(pr),
    draft: pr.isDraft,
    mergedAt: pr.mergedAt,
    closedAt: closedAt(pr),
    author: pr.author,
    role,
    whoseMove: { kind: turn.kind, move: turn.kind === 'you' ? turn.move : null, who: turn.who, what: turn.what },
    fetchedAt: input.fetchedAt,
    untrusted: { title: pr.title },
    signals: branchSignals(pr, viewer, role),
  };
}

/** The cutoff for merged and closed PRs: `days` before `now`. */
export function branchesSince(now: Date, days: number): IsoTime {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Every entry among `inputs` in the window and the repo, open ones first,
 * then the most recently updated first.
 */
export function branchesView(inputs: BranchInput[], viewer: Viewer, now: Date, options: BranchesOptions): BranchesView {
  const since = branchesSince(now, options.days);
  const entries: Array<{ entry: BranchEntry; updatedAt: IsoTime }> = [];
  for (const input of inputs) {
    if (options.repo !== null && input.pr.ref.repo.toLowerCase() !== options.repo.toLowerCase()) {
      continue;
    }
    if (!inBranchWindow(input.pr, since)) {
      continue;
    }
    const entry = branchEntry(input, viewer);
    if (entry !== null) {
      entries.push({ entry, updatedAt: input.pr.updatedAt });
    }
  }
  entries.sort((a, b) => Number(b.entry.state === 'open') - Number(a.entry.state === 'open') || b.updatedAt.localeCompare(a.updatedAt));
  return { generatedAt: now.toISOString(), viewer: viewer.login, prs: entries.map((item) => item.entry) };
}
