// "Whose turn": is the next move on a tile the viewer's, someone else's, or
// nobody's? Rules only, no agent. DESIGN.md "Whose turn" lists them.
import { isBot } from './bots.ts';
import { isUnseenLoud } from './loudness.ts';
import { isPinged } from './provenance.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { EventKind, Pr, PrEvent, PrKey, Review, Tile, UserPrState, Viewer } from './types.ts';

export type WhoseTurnKind = 'you' | 'them' | 'none';

export interface WhoseTurn {
  kind: WhoseTurnKind;
  /** them: the login the move waits on. Null for you and none. */
  who: string | null;
  /**
   * you: the move ("Re-check 2 commits on #41850"). them: the rest of the
   * sentence after the name ("to merge"). none: empty.
   */
  what: string;
  /** The PR the move is about. Null for none. */
  prKey: PrKey | null;
}

export interface WhoseTurnInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  viewer: Viewer | null;
}

export const NO_TURN: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };

const TURN_ORDER: Record<WhoseTurnKind, number> = { you: 0, them: 1, none: 2 };

/** Events that ask the viewer something directly. */
const ASK_KINDS: EventKind[] = ['question_to_user', 'mention', 'reply_to_user', 'team_mention'];

interface PrContext {
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  viewer: Viewer;
  /** " on #41850" on multi-PR tiles, "" on a single PR tile. */
  where: string;
}

function you(ctx: PrContext, what: string): WhoseTurn {
  return { kind: 'you', who: null, what: `${what}${ctx.where}`, prKey: ctx.pr.key };
}

function them(ctx: PrContext, who: string, what: string): WhoseTurn {
  return { kind: 'them', who, what: `${what}${ctx.where}`, prKey: ctx.pr.key };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function isViewer(ctx: PrContext, login: string): boolean {
  return sameLogin(login, ctx.viewer.login);
}

/** The viewer commented or reviewed after `since`. */
function spokeSince(ctx: PrContext, since: string): boolean {
  const comment = ctx.pr.comments.some((c) => isViewer(ctx, c.author) && c.createdAt > since);
  const review = ctx.pr.reviews.some((r) => isViewer(ctx, r.author) && r.state !== 'PENDING' && r.submittedAt > since);
  return comment || review;
}

/** The newest human mention, question or reply to the viewer they have not answered yet. */
function openAsk(ctx: PrContext): PrEvent | null {
  let newest: PrEvent | null = null;
  for (const event of ctx.events) {
    if (!ASK_KINDS.includes(event.kind) || event.isBot || isViewer(ctx, event.actor)) {
      continue;
    }
    if (spokeSince(ctx, event.at)) {
      continue;
    }
    if (newest === null || event.at > newest.at) {
      newest = event;
    }
  }
  return newest;
}

function viewerReviews(ctx: PrContext): Review[] {
  return ctx.pr.reviews
    .filter((r) => isViewer(ctx, r.author) && r.state !== 'PENDING' && r.state !== 'DISMISSED')
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
}

/** The viewer's newest review of the current head, if any. */
function headReview(ctx: PrContext): Review | null {
  const onHead = viewerReviews(ctx).filter((r) => r.commitOid === ctx.pr.headOid);
  return onHead[onHead.length - 1] ?? null;
}

/**
 * Commits that landed after the viewer's approval of an older head, or 0.
 * The app's own approval record wins; a github.com approval counts too.
 */
function commitsAfterApproval(ctx: PrContext): number {
  const approvals = viewerReviews(ctx).filter((r) => r.state === 'APPROVED');
  const lastApproval = approvals[approvals.length - 1];
  const oid = ctx.userState?.approvedCommitOid ?? lastApproval?.commitOid ?? null;
  const approvedAt = ctx.userState?.approvedAt ?? lastApproval?.submittedAt ?? null;
  if (oid === null || approvedAt === null || oid === ctx.pr.headOid) {
    return 0;
  }
  const index = ctx.pr.commits.findIndex((commit) => commit.oid === oid);
  const after = index >= 0 ? ctx.pr.commits.length - index - 1 : ctx.pr.commits.filter((c) => c.committedAt > approvedAt).length;
  // The head moved, so at least one commit is new even when the snapshot lacks the list.
  return Math.max(after, 1);
}

/** Who asked the viewer (or their team) for a review, from the newest request event. */
function requester(ctx: PrContext): string | null {
  const requests = ctx.events.filter((e) => e.kind === 'review_requested' && !e.isBot).sort((a, b) => (a.at < b.at ? -1 : 1));
  return requests[requests.length - 1]?.actor ?? null;
}

/** Humans other than the author and the viewer who submitted a review. */
function otherReviewers(ctx: PrContext): string[] {
  const logins = ctx.pr.reviews
    .filter((r) => r.state !== 'PENDING' && !isViewer(ctx, r.author) && !sameLogin(r.author, ctx.pr.author) && !isBot(r.author))
    .map((r) => r.author);
  return [...new Set(logins)];
}

type ReviewAsk = 'you' | 'team' | 'team_taken' | null;

/**
 * you: the viewer is a requested reviewer. team: one of the viewer's teams
 * is, and nobody but the author has reviewed yet. team_taken: a team request
 * someone else already picked up. We do not know who is on the team, so any
 * other reviewer counts as the teammate.
 */
function reviewAsk(ctx: PrContext): ReviewAsk {
  if (ctx.pr.reviewerUsers.some((login) => isViewer(ctx, login))) {
    return 'you';
  }
  if (!ctx.pr.reviewerTeams.some((team) => isOwnTeam(team, ctx.viewer.teams))) {
    return null;
  }
  return otherReviewers(ctx).length === 0 ? 'team' : 'team_taken';
}

function ownTeamSlug(ctx: PrContext): string {
  const team = ctx.pr.reviewerTeams.find((slug) => isOwnTeam(slug, ctx.viewer.teams)) ?? 'your team';
  return team.split('/').pop() ?? team;
}

const ASK_VERBS: Record<string, { alone: (actor: string) => string; withReview: string }> = {
  question_to_user: { alone: (actor) => `Answer ${actor}'s question`, withReview: 'asked you something' },
  mention: { alone: (actor) => `Reply to ${actor}'s mention`, withReview: 'mentioned you' },
  reply_to_user: { alone: (actor) => `Reply to ${actor}`, withReview: 'replied to you' },
  team_mention: { alone: (actor) => `Reply to ${actor}, your team was mentioned`, withReview: 'mentioned your team' },
};

function askText(ask: PrEvent, reviewToo: boolean): string {
  const verbs = ASK_VERBS[ask.kind]!;
  return reviewToo ? `Review, ${ask.actor} ${verbs.withReview}` : verbs.alone(ask.actor);
}

function reviewText(ctx: PrContext, ask: ReviewAsk): string {
  if (ask === 'team') {
    return `Review for ${ownTeamSlug(ctx)}`;
  }
  const by = requester(ctx);
  return by && !isViewer(ctx, by) ? `Review, ${by} asked` : 'Review';
}

/** Unresolved threads whose last word is someone else's (not the viewer's, not a bot's). */
function threadsWaitingOnViewer(ctx: PrContext): { count: number; from: string | null } {
  const lastAuthors: string[] = [];
  for (const thread of ctx.pr.threads) {
    const last = thread.comments[thread.comments.length - 1];
    if (thread.isResolved || !last || isViewer(ctx, last.author) || isBot(last.author)) {
      continue;
    }
    lastAuthors.push(last.author);
  }
  const everyone = new Set(lastAuthors.map((login) => login.toLowerCase()));
  return { count: lastAuthors.length, from: everyone.size === 1 ? lastAuthors[0]! : null };
}

/** Unresolved threads the viewer started, waiting for the author. */
function threadsViewerOpened(ctx: PrContext): number {
  return ctx.pr.threads.filter((thread) => !thread.isResolved && thread.comments[0] && isViewer(ctx, thread.comments[0].author)).length;
}

/** Reviewers whose standing review asks for changes (a later approval clears it). */
function changesRequestedBy(ctx: PrContext): string | null {
  const latest = new Map<string, Review>();
  for (const review of [...ctx.pr.reviews].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1))) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      latest.set(review.author.toLowerCase(), review);
    }
  }
  const asking = [...latest.values()].find((review) => review.state === 'CHANGES_REQUESTED');
  return asking?.author ?? null;
}

function ownPrTurn(ctx: PrContext): WhoseTurn {
  const { pr } = ctx;
  const threads = threadsWaitingOnViewer(ctx);
  if (threads.count > 0) {
    return you(ctx, `Answer ${plural(threads.count, 'thread')}${threads.from ? ` from ${threads.from}` : ''}`);
  }
  const changesBy = changesRequestedBy(ctx);
  if (changesBy) {
    return you(ctx, `Address ${changesBy}'s changes`);
  }
  if (pr.checks.rollup === 'FAILURE') {
    return you(ctx, 'Fix failing CI');
  }
  const waitingOn = pr.reviewerUsers[0] ?? pr.reviewerTeams[0];
  if (waitingOn) {
    return them(ctx, waitingOn, 'to review');
  }
  if (!pr.isDraft && pr.reviewDecision === 'APPROVED') {
    return you(ctx, 'Merge, it is approved');
  }
  return NO_TURN;
}

function othersPrTurn(ctx: PrContext): WhoseTurn {
  const { pr } = ctx;
  const ask = reviewAsk(ctx);
  const reviewed = headReview(ctx);
  const commits = commitsAfterApproval(ctx);
  if (reviewed === null && commits > 0) {
    return you(ctx, `Re-check ${plural(commits, 'commit')}`);
  }
  if (reviewed === null && (ask === 'you' || ask === 'team')) {
    return you(ctx, reviewText(ctx, ask));
  }
  if (reviewed?.state === 'APPROVED') {
    return them(ctx, pr.author, 'to merge');
  }
  if (reviewed) {
    const opened = threadsViewerOpened(ctx);
    if (opened > 0) {
      return them(ctx, pr.author, `to address ${plural(opened, 'thread')}`);
    }
    return them(ctx, pr.author, reviewed.state === 'CHANGES_REQUESTED' ? 'to address your changes' : 'to reply');
  }
  if (ask === 'team_taken') {
    if (pr.reviewDecision === 'APPROVED') {
      return them(ctx, pr.author, 'to merge');
    }
    return them(ctx, otherReviewers(ctx)[0]!, 'is reviewing');
  }
  return NO_TURN;
}

function prTurn(ctx: PrContext): WhoseTurn {
  if (ctx.pr.state !== 'OPEN') {
    return NO_TURN;
  }
  const ask = openAsk(ctx);
  if (ask) {
    const reviewToo = sameLogin(ctx.pr.author, ctx.viewer.login) ? false : reviewAsk(ctx) === 'you' && headReview(ctx) === null;
    return you(ctx, askText(ask, reviewToo));
  }
  return sameLogin(ctx.pr.author, ctx.viewer.login) ? ownPrTurn(ctx) : othersPrTurn(ctx);
}

/** When the newest unseen loud event on the PR happened, '' when there is none. */
function newestUnseenLoudAt(events: PrEvent[]): string {
  let newest = '';
  for (const event of events) {
    if (isUnseenLoud(event) && event.at > newest) {
      newest = event.at;
    }
  }
  return newest;
}

/**
 * Whose move it is on a tile. Each pinged PR gets a turn by the rules in
 * DESIGN.md; the tile takes the most urgent one (you over them over none).
 * On a tie the PR with the newest unseen loud event wins, so the footer
 * talks about the same PR as the unread strip; else the first in tile order.
 * Multi-PR tiles name the PR.
 */
export function whoseTurn(input: WhoseTurnInput): WhoseTurn {
  const viewer = input.viewer;
  if (viewer === null) {
    return NO_TURN;
  }
  const multi = input.tile.members.length > 1;
  let best = NO_TURN;
  let bestNews = '';
  for (const member of input.tile.members) {
    const pr = input.prs.get(member.prKey);
    if (!pr || !isPinged(member.provenance)) {
      continue;
    }
    const events = input.events.get(pr.key) ?? [];
    const turn = prTurn({
      pr,
      events,
      userState: input.userStates.get(pr.key) ?? null,
      viewer,
      where: multi ? ` on #${pr.ref.number}` : '',
    });
    const news = newestUnseenLoudAt(events);
    const moreUrgent = TURN_ORDER[turn.kind] < TURN_ORDER[best.kind];
    const sameButNewer = turn.kind !== 'none' && turn.kind === best.kind && news > bestNews;
    if (moreUrgent || sameButNewer) {
      best = turn;
      bestNews = news;
    }
  }
  return best;
}
