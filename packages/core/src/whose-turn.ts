// "Whose turn": is the next move on a tile the viewer's, someone else's, or
// nobody's? Rules only, no agent. DESIGN.md "Whose turn" lists them.
import { isBot } from './bots.ts';
import { changesAnswered, type ChangesAnswer } from './changes-answered.ts';
import { isUnseenLoud } from './loudness.ts';
import { isTracked } from './provenance.ts';
import { isApprovedByViewer } from './tiles.ts';
import { PERSONAL_ASK_KINDS } from './kinds.ts';
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
  /**
   * them: words before the name, for turns where the name is not the
   * sentence's subject ("Waiting on" sol). Absent means none.
   */
  lead?: string;
}

export interface WhoseTurnInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  viewer: Viewer | null;
}

/** The move on the viewer's own approved PR. It shows on the tile, but it is not urgent. */
export const MERGE_APPROVED_MOVE = 'Merge, it is approved';

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

/** Own PR waiting on reviewers: "Waiting on sol and 1 more". */
function waitingOn(ctx: PrContext, who: string, more: number): WhoseTurn {
  const rest = [more > 0 ? `and ${more} more` : '', ctx.where.trim()].filter((part) => part !== '').join(' ');
  return { kind: 'them', who, what: rest, prKey: ctx.pr.key, lead: 'Waiting on' };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function isViewer(ctx: PrContext, login: string): boolean {
  return sameLogin(login, ctx.viewer.login);
}

/** The viewer commented or reviewed on the PR after `since`. */
function spokeSince(pr: Pr, viewer: Viewer, since: string): boolean {
  const comment = pr.comments.some((c) => sameLogin(c.author, viewer.login) && c.createdAt > since);
  const review = pr.reviews.some((r) => sameLogin(r.author, viewer.login) && r.state !== 'PENDING' && r.submittedAt > since);
  return comment || review;
}

/**
 * The newest human event of `kinds` aimed at the viewer that they have not
 * answered since (no comment or review after it). Also used by `prTier`.
 */
export function unansweredAsk(pr: Pr, events: PrEvent[], viewer: Viewer, kinds: EventKind[] = ASK_KINDS): PrEvent | null {
  let newest: PrEvent | null = null;
  for (const event of events) {
    if (!kinds.includes(event.kind) || event.isBot || sameLogin(event.actor, viewer.login)) {
      continue;
    }
    if (spokeSince(pr, viewer, event.at)) {
      continue;
    }
    if (newest === null || event.at > newest.at) {
      newest = event;
    }
  }
  return newest;
}

/** The newest human mention, question or reply to the viewer they have not answered yet. */
function openAsk(ctx: PrContext): PrEvent | null {
  return unansweredAsk(ctx.pr, ctx.events, ctx.viewer);
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

/**
 * Other reviewers who are on one of the viewer's teams. Until the member
 * list has been fetched (`teamMembers` missing) any other reviewer counts.
 */
function teammateReviewers(ctx: PrContext): string[] {
  const members = ctx.viewer.teamMembers;
  const others = otherReviewers(ctx);
  if (members === undefined) {
    return others;
  }
  return others.filter((login) => members.some((member) => sameLogin(member, login)));
}

type ReviewAsk = 'you' | 'team' | 'team_taken' | null;

/**
 * you: the viewer is a requested reviewer. team: one of the viewer's teams
 * is, and no teammate has reviewed yet. team_taken: a teammate already
 * picked the team request up.
 */
function reviewAsk(ctx: PrContext): ReviewAsk {
  if (ctx.pr.reviewerUsers.some((login) => isViewer(ctx, login))) {
    return 'you';
  }
  if (!ctx.pr.reviewerTeams.some((team) => isOwnTeam(team, ctx.viewer.teams))) {
    return null;
  }
  return teammateReviewers(ctx).length === 0 ? 'team' : 'team_taken';
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
  // Users before teams; the viewer's own team can sit here too (CODEOWNERS).
  const reviewers = [...pr.reviewerUsers, ...pr.reviewerTeams];
  if (reviewers.length > 0) {
    return waitingOn(ctx, reviewers[0]!, reviewers.length - 1);
  }
  if (!pr.isDraft && pr.reviewDecision === 'APPROVED') {
    return you(ctx, MERGE_APPROVED_MOVE);
  }
  return NO_TURN;
}

function othersPrTurn(ctx: PrContext): WhoseTurn {
  const { pr } = ctx;
  const ask = reviewAsk(ctx);
  // An approval on any commit stands; a push after it is not the viewer's move.
  if (isApprovedByViewer(pr, ctx.userState, ctx.viewer.login)) {
    return them(ctx, pr.author, 'to merge');
  }
  const reviewed = headReview(ctx);
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
    return them(ctx, teammateReviewers(ctx)[0]!, 'is reviewing');
  }
  return NO_TURN;
}

/**
 * Drafts: nobody reviews, approves or merges one right away. Only a personal
 * question, mention or reply is a move ("Reply to ada on draft"); on the
 * viewer's own draft also review comments to address. Never review, re-check
 * or merge.
 */
function draftTurn(ctx: PrContext): WhoseTurn {
  const ask = unansweredAsk(ctx.pr, ctx.events, ctx.viewer, [...PERSONAL_ASK_KINDS]);
  if (ask) {
    return you(ctx, `Reply to ${ask.actor} on draft`);
  }
  if (!sameLogin(ctx.pr.author, ctx.viewer.login)) {
    return NO_TURN;
  }
  const threads = threadsWaitingOnViewer(ctx);
  if (threads.count > 0) {
    return you(ctx, `Address ${plural(threads.count, 'comment')} on your draft`);
  }
  const changesBy = changesRequestedBy(ctx);
  if (changesBy) {
    return you(ctx, `Address ${changesBy}'s changes on your draft`);
  }
  return NO_TURN;
}

/** "paul addressed your changes: re-review", or "paul replied to your review" when there was no push. */
function changesAnsweredText(author: string, answer: ChangesAnswer): string {
  return answer.pushed ? `${author} addressed your changes: re-review` : `${author} replied to your review`;
}

function prTurn(ctx: PrContext): WhoseTurn {
  if (ctx.pr.state !== 'OPEN') {
    return NO_TURN;
  }
  if (ctx.pr.isDraft) {
    return draftTurn(ctx);
  }
  const ask = openAsk(ctx);
  // The author's thread replies are asks too; the answer to the changes
  // request says more. An ask from anyone else still goes first.
  const answer = changesAnswered(ctx.pr, ctx.viewer);
  if (answer && (ask === null || sameLogin(ask.actor, ctx.pr.author))) {
    return you(ctx, changesAnsweredText(ctx.pr.author, answer));
  }
  if (ask) {
    const reviewToo = sameLogin(ctx.pr.author, ctx.viewer.login)
      ? false
      : reviewAsk(ctx) === 'you' && headReview(ctx) === null && !isApprovedByViewer(ctx.pr, ctx.userState, ctx.viewer.login);
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

/** Your move, and it is only merging your own approved PR (multi-PR tiles add " on #n"). */
export function isMergeApprovedMove(turn: WhoseTurn): boolean {
  return turn.kind === 'you' && turn.what.startsWith(MERGE_APPROVED_MOVE);
}

/**
 * Whose move it is on a tile. Each pinged or found PR gets a turn by the rules in
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
    if (!pr || !isTracked(member.provenance)) {
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
