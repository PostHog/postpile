// "Whose turn": is the next move on a tile the viewer's, someone else's, or
// nobody's? Rules only, no agent. DESIGN.md "Whose turn" lists them.
import { isBot, isMadeByAutomation } from './bots.ts';
import { changesAnswered, standingChanges, type ChangesAnswer } from './changes-answered.ts';
import { effectiveLoudness, isUnseenLoud } from './loudness.ts';
import { isTracked } from './provenance.ts';
import { ADDRESSED_KINDS, PERSONAL_ASK_KINDS } from './kinds.ts';
import { lastTouch } from './last-touch.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import {
  changesRequestedBy,
  isApprovedByViewer,
  isPersonalRequest,
  requestsOfViewer,
  reviewRequest,
  teamRequestHold,
  teamRequestTakenBy,
  viewerHeadReview,
  type ReviewRequest,
} from './review-request.ts';
import type { EventKind, Pr, PrEvent, PrKey, Tile, UserPrState, Viewer } from './types.ts';

export type WhoseTurnKind = 'you' | 'them' | 'none';

/**
 * The kind of move a `you` turn asks for, so the sidebar row can name it.
 * reply: an ask (question, mention, reply, team mention), also on a draft.
 * re_review: the author addressed your changes. review: a review request,
 * personal or for your team. address_changes: threads or a change request
 * on your own PR or draft. merge: your PR is approved. CI is never a move
 * (DESIGN.md "CI is not a signal").
 */
export type YourMove = 'reply' | 're_review' | 'review' | 'address_changes' | 'merge';

/** Most urgent first, in the order of the sidebar sections. */
export const YOUR_MOVE_ORDER: YourMove[] = ['reply', 're_review', 'review', 'address_changes', 'merge'];

interface TurnFields {
  /** them: the login the move waits on. Null for you and none. */
  who: string | null;
  /**
   * you: the move ("Re-check 2 commits on #1850"). them: the rest of the
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

/** A `you` turn always says what kind of move it is. */
export type WhoseTurn = (TurnFields & { kind: 'you'; move: YourMove }) | (TurnFields & { kind: 'them' | 'none' });

export interface WhoseTurnInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  viewer: Viewer | null;
  /** PRs whose agent glance says NOT_YOURS: a routed team request on them asks nothing of the viewer. */
  notYours?: ReadonlySet<PrKey>;
}

/** A reviewer who asked for changes, after the push and their re-request: "ada to re-review". */
const RE_REVIEW = 'to re-review';

/** The move on the viewer's own approved PR. It shows on the tile, but it is not urgent. */
export const MERGE_APPROVED_MOVE = 'Merge, it is approved';

export const NO_TURN: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };

const TURN_ORDER: Record<WhoseTurnKind, number> = { you: 0, them: 1, none: 2 };

interface PrContext {
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  viewer: Viewer;
  /** " on #1850" on multi-PR tiles, "" on a single PR tile. */
  where: string;
  /** The agent's glance says the PR is not the viewer's. */
  notYours: boolean;
}

function you(ctx: PrContext, move: YourMove, what: string): WhoseTurn {
  return { kind: 'you', move, who: null, what: `${what}${ctx.where}`, prKey: ctx.pr.key };
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

/**
 * The viewer touched the PR after `since` (`lastTouch`, the same definition
 * that makes earlier events seen): a comment or review, or a push to their
 * own PR. A push answers "this needs a merge-in from master" (2026-09-29).
 */
function touchedSince(pr: Pr, events: PrEvent[], viewer: Viewer, since: string): boolean {
  const touch = lastTouch(pr, events, viewer);
  return touch !== null && touch.at > since;
}

/**
 * A human event of `kinds` aimed at the viewer that they have not answered
 * since (no touch after it: comment, review, push to their own PR; `events`
 * are the PR's events, where the touches are). A team mention only asks until it
 * is read: once seen (mark-read in the app or read on GitHub) it no longer
 * counts (decided 2026-09-28). Personal asks count until answered. An event
 * the events agent lowered to quiet or muted ("thanks, that's fine") asks
 * nothing (decided 2026-09-29).
 */
export function isUnansweredAsk(pr: Pr, events: PrEvent[], event: PrEvent, viewer: Viewer, kinds: readonly EventKind[] = ADDRESSED_KINDS): boolean {
  if (!kinds.includes(event.kind) || isMadeByAutomation(event) || sameLogin(event.actor, viewer.login)) {
    return false;
  }
  if (event.kind === 'team_mention' && event.seenAt !== null) {
    return false;
  }
  if (effectiveLoudness(event) !== 'loud') {
    return false;
  }
  return !touchedSince(pr, events, viewer, event.at);
}

/** The newest unanswered ask on the PR (`isUnansweredAsk`). Also used by `prTier`. */
export function unansweredAsk(pr: Pr, events: PrEvent[], viewer: Viewer, kinds: readonly EventKind[] = ADDRESSED_KINDS): PrEvent | null {
  let newest: PrEvent | null = null;
  for (const event of events) {
    if (!isUnansweredAsk(pr, events, event, viewer, kinds)) {
      continue;
    }
    if (newest === null || event.at > newest.at) {
      newest = event;
    }
  }
  return newest;
}

/**
 * Who asked the viewer (or their team) for a review: the newest human
 * request aimed at them in the timeline. A bot's request still asks (see
 * `isAutomation`), the text just does not name the bot.
 */
function requester(ctx: PrContext): string | null {
  const requests = requestsOfViewer(ctx.pr, ctx.viewer).filter((item) => !isBot(item.actor));
  return requests[requests.length - 1]?.actor ?? null;
}

function ownTeamSlug(ctx: PrContext): string {
  const team = ctx.pr.reviewerTeams.find((slug) => isOwnTeam(slug, ctx.viewer.teams)) ?? 'your team';
  return team.split('/').pop() ?? team;
}

// A question asks for an answer; a mention or a reply says what happened and
// does not presume one (Julian, 2026-09-29: a comment not written as needing a
// reply from you is no "Reply to"). The move stays `reply` either way.
const ASK_VERBS: Record<string, { alone: (actor: string) => string; withReview: string }> = {
  question_to_user: { alone: (actor) => `Answer ${actor}'s question`, withReview: 'asked you something' },
  mention: { alone: (actor) => `${actor} mentioned you`, withReview: 'mentioned you' },
  reply_to_user: { alone: (actor) => `${actor} replied to you`, withReview: 'replied to you' },
  team_mention: { alone: (actor) => `${actor} mentioned your team`, withReview: 'mentioned your team' },
};

function askText(ask: PrEvent, reviewToo: boolean): string {
  const verbs = ASK_VERBS[ask.kind]!;
  return reviewToo ? `Review, ${ask.actor} ${verbs.withReview}` : verbs.alone(ask.actor);
}

function reviewText(ctx: PrContext, ask: ReviewRequest): string {
  if (ask === 'team') {
    return `Review for ${ownTeamSlug(ctx)}`;
  }
  if (ask === 'team_for_you') {
    return `Review for ${ownTeamSlug(ctx)}: ${ctx.pr.author}'s PR`;
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

function ownPrTurn(ctx: PrContext): WhoseTurn {
  const { pr } = ctx;
  const threads = threadsWaitingOnViewer(ctx);
  if (threads.count > 0) {
    return you(ctx, 'address_changes', `Answer ${plural(threads.count, 'thread')}${threads.from ? ` from ${threads.from}` : ''}`);
  }
  const changes = standingChanges(pr);
  if (changes?.kind === 're_review') {
    // You pushed and asked every one of them again: their move now.
    return them(ctx, changes.by, RE_REVIEW);
  }
  if (changes) {
    return you(ctx, 'address_changes', `Address ${changes.by}'s changes`);
  }
  // Users before teams; the viewer's own team can sit here too (CODEOWNERS).
  const reviewers = [...pr.reviewerUsers, ...pr.reviewerTeams];
  if (reviewers.length > 0) {
    return waitingOn(ctx, reviewers[0]!, reviewers.length - 1);
  }
  if (!pr.isDraft && pr.reviewDecision === 'APPROVED') {
    return you(ctx, 'merge', MERGE_APPROVED_MOVE);
  }
  return NO_TURN;
}

function othersPrTurn(ctx: PrContext): WhoseTurn {
  const { pr } = ctx;
  const ask = reviewRequest(ctx.pr, ctx.viewer);
  // An approval on any commit stands; a push after it is not the viewer's move.
  if (isApprovedByViewer(pr, ctx.userState, ctx.viewer.login)) {
    return them(ctx, pr.author, 'to merge');
  }
  const reviewed = viewerHeadReview(ctx.pr, ctx.viewer);
  const hold = reviewed === null ? teamRequestHold(pr, ctx.viewer, ctx.notYours) : null;
  if (hold?.kind === 'not_yours') {
    return NO_TURN;
  }
  const changes = hold?.kind === 'changes' ? standingChanges(pr, ctx.viewer.login) : null;
  if (changes) {
    // The author moves first, until they pushed and asked every requester again.
    return changes.kind === 're_review' ? them(ctx, changes.by, RE_REVIEW) : them(ctx, pr.author, `to address ${changes.by}'s changes`);
  }
  if (reviewed === null && (isPersonalRequest(ask) || ask === 'team')) {
    return you(ctx, 'review', reviewText(ctx, ask));
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
    const changes = standingChanges(pr);
    if (changes?.kind === 're_review') {
      return them(ctx, changes.by, RE_REVIEW);
    }
    return them(ctx, teamRequestTakenBy(ctx.pr, ctx.viewer)[0]!, 'is reviewing');
  }
  return NO_TURN;
}

/**
 * Drafts: nobody reviews, approves or merges one right away. Only a personal
 * question, mention or reply is a move ("Answer ada's question on draft"); on the
 * viewer's own draft also review comments to address. Never review, re-check
 * or merge.
 */
function draftTurn(ctx: PrContext): WhoseTurn {
  const ask = unansweredAsk(ctx.pr, ctx.events, ctx.viewer, PERSONAL_ASK_KINDS);
  if (ask) {
    return you(ctx, 'reply', `${askText(ask, false)} on draft`);
  }
  if (!sameLogin(ctx.pr.author, ctx.viewer.login)) {
    return NO_TURN;
  }
  const threads = threadsWaitingOnViewer(ctx);
  if (threads.count > 0) {
    return you(ctx, 'address_changes', `Address ${plural(threads.count, 'comment')} on your draft`);
  }
  const changesBy = changesRequestedBy(ctx.pr);
  if (changesBy) {
    return you(ctx, 'address_changes', `Address ${changesBy}'s changes on your draft`);
  }
  return NO_TURN;
}

/** "pim addressed your changes: re-review", or "pim replied to your review" when there was no push. */
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
  const ask = unansweredAsk(ctx.pr, ctx.events, ctx.viewer);
  // The author's thread replies are asks too; the answer to the changes
  // request says more. An ask from anyone else still goes first.
  const answer = changesAnswered(ctx.pr, ctx.viewer);
  if (answer && (ask === null || sameLogin(ask.actor, ctx.pr.author))) {
    return you(ctx, 're_review', changesAnsweredText(ctx.pr.author, answer));
  }
  if (ask) {
    const reviewToo = sameLogin(ctx.pr.author, ctx.viewer.login)
      ? false
      : isPersonalRequest(reviewRequest(ctx.pr, ctx.viewer)) && viewerHeadReview(ctx.pr, ctx.viewer) === null && !isApprovedByViewer(ctx.pr, ctx.userState, ctx.viewer.login);
    return you(ctx, 'reply', askText(ask, reviewToo));
  }
  return sameLogin(ctx.pr.author, ctx.viewer.login) ? ownPrTurn(ctx) : othersPrTurn(ctx);
}

/** Whose move it is on one PR, as a single-PR tile would say it (tracked or not). */
export function prWhoseTurn(input: { pr: Pr; events: PrEvent[]; userState: UserPrState | null; viewer: Viewer; notYours?: boolean }): WhoseTurn {
  return prTurn({ ...input, where: '', notYours: input.notYours ?? false });
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
  return turn.kind === 'you' && turn.move === 'merge';
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
      notYours: input.notYours?.has(pr.key) ?? false,
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
