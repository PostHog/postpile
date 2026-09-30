// The PR rows and the tile view the UI gets, built from gathered inputs. The
// engine and FakeEngine only collect the inputs (store or sample data); the
// rules that turn them into a view live here, once.
import { prAfterMarkRead, tileAfterMarkRead } from './after-read.ts';
import { isBot } from './bots.ts';
import { forWhom, tileForWhom } from './for-whom.ts';
import { lastTouch } from './last-touch.ts';
import { isUnseenLoud } from './loudness.ts';
import { tileOffers } from './offers.ts';
import { prOwners } from './pr-owners.ts';
import { prStatus, openThreadCount } from './pr-status.ts';
import { prTier } from './pr-tier.ts';
import { prPrimaryAction } from './primary-action.ts';
import { isApprovedByViewer, ownTeamRequests, reviewRequest } from './review-request.ts';
import { tilePeople } from './tile-people.ts';
import { isTracked } from './provenance.ts';
import { isPrDone, TILE_STATE_ORDER } from './tiles.ts';
import { memberTier, ownerRelation, tileTier } from './topic-queues.ts';
import type { Glance, IsoTime, NotificationReason, Pr, PrEvent, PrKey, Tile, TileMember, TileState, UserPrState, Viewer } from './types.ts';
import type { GlanceState } from './glance-state.ts';
import type { GlanceGap, PrFacts, PrSummary, TilePendingWrite, TileView } from './views.ts';
import { whatsNew } from './whats-new.ts';
import { NO_TURN, prWhoseTurn, unansweredAsk, whoseTurn } from './whose-turn.ts';
import { tileWhy, whyHere } from './why-here.ts';

export interface PrSummaryInput {
  pr: Pr;
  member: TileMember;
  /** Null before the first sync stored one: nothing is aimed at anyone yet. */
  viewer: Viewer | null;
  userState: UserPrState | null;
  events: PrEvent[];
  /** The notification thread's reason, for the tier; null without a thread. */
  reason: NotificationReason | null;
  glance: Pick<Glance, 'verdict' | 'forYou'> | null;
  glanceStale: boolean;
  glanceGap: GlanceGap | null;
  glanceState: GlanceState;
  quietRepo: boolean;
  repoLabel: string | null;
  /** The tile is unread, so the primary action may be Mark read. */
  tileUnread: boolean;
  /** The PR's notification thread is unread on GitHub. */
  unreadOnGitHub: boolean;
  /** Now, for what the PR would turn into once marked read (`afterRead`). */
  now: IsoTime;
  /** A mark-read of this PR waiting for the writes lock, or null. */
  pendingWrite: TilePendingWrite | null;
}

/** The PR facts every consumer reads (`PrFacts`); without a viewer nothing is aimed at anyone. */
export function prFacts(pr: Pr, events: PrEvent[], viewer: Viewer | null): PrFacts {
  const ask = viewer ? unansweredAsk(pr, events, viewer) : null;
  return {
    owners: prOwners(pr),
    ownerIsAutomation: prOwners(pr).every((owner) => isBot(owner)),
    reviewRequest: viewer ? reviewRequest(pr, viewer) : null,
    lastTouch: viewer ? lastTouch(pr, events, viewer) : null,
    openAsk: ask ? { id: ask.id, kind: ask.kind, actor: ask.actor, summary: ask.summary, at: ask.at } : null,
  };
}

/** One PR row of a tile. */
export function buildPrSummary(input: PrSummaryInput): PrSummary {
  const { pr, member, viewer, userState, events } = input;
  const authorRelation = ownerRelation(pr, viewer);
  const approved = isApprovedByViewer(pr, userState, viewer?.login);
  const why = whyHere(member.provenance, pr, viewer);
  const tier = viewer ? prTier({ pr, events, viewer, userState, reason: input.reason }) : 'rest';
  // Same NOT_YOURS reading as the Board's (the stored glance, stale or not).
  const notYours = input.glance?.verdict === 'NOT_YOURS';
  return {
    key: pr.key,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    assignees: pr.assignees ?? [],
    state: pr.state,
    isDraft: pr.isDraft,
    provenance: member.provenance,
    why,
    forWhom: forWhom(why, pr, viewer),
    tier: memberTier(tier, member.provenance, input.quietRepo),
    authorRelation,
    primaryAction: prPrimaryAction({ state: pr.state, authorRelation, approved, tileUnread: input.tileUnread }),
    status: prStatus(pr),
    openThreads: openThreadCount(pr),
    verdict: input.glance?.verdict ?? null,
    glanceStale: input.glanceStale,
    forYou: input.glance?.forYou ?? null,
    glanceGap: input.glanceGap,
    glanceState: input.glanceState,
    // A found PR never counts as unread; its events are there for whose turn and memory.
    unseenLoudEvents: member.provenance.kind === 'found' ? 0 : events.filter(isUnseenLoud).length,
    unreadOnGitHub: input.unreadOnGitHub,
    done: isPrDone(pr, userState, viewer, events, notYours),
    ownTeamRequests: viewer ? ownTeamRequests(pr, viewer) : [],
    pendingWrite: input.pendingWrite,
    turn: viewer ? prWhoseTurn({ pr, events, userState, viewer, notYours }) : NO_TURN,
    facts: prFacts(pr, events, viewer),
    afterRead: prAfterMarkRead({ pr, events, userState, viewer, notYours, tracked: isTracked(member.provenance), readAt: input.now }),
    whatsNew: member.provenance.kind === 'found' ? null : whatsNew(pr, events, viewer),
    updatedAt: pr.updatedAt,
    quietRepo: input.quietRepo,
    repoLabel: input.repoLabel,
  };
}

/**
 * The PRs that keep the tile from being done (2026-09-29, replaced "the new
 * dot"): every tracked PR that is not done (`PrSummary.done`, `isPrDone`),
 * or that still has an unseen loud event or a thread unread on GitHub (both
 * keep the tile from being done). A pulled-in stack layer counts once it has unseen loud news
 * (2026-09-30): that news keeps the tile from being done. Their rows get the
 * coral dot ("Not done yet"), on unread and open tiles alike; a done or
 * snoozed tile has none. Mark a dotted PR done and its dot goes; no dots
 * left, the tile is done. Only where it says which PR holds the tile: with
 * a single PR that can hold it the dot would only repeat the tile's state.
 */
export function notDonePrKeys(view: Pick<TileView, 'state' | 'prs'>): PrKey[] {
  if (view.state.kind !== 'unread' && view.state.kind !== 'open') {
    return [];
  }
  const counted = view.prs.filter((pr) => isTracked(pr.provenance) || pr.unseenLoudEvents > 0);
  if (counted.length <= 1) {
    return [];
  }
  return counted.filter((pr) => !pr.done || pr.unseenLoudEvents > 0 || pr.unreadOnGitHub).map((pr) => pr.key);
}

export interface TileViewInput {
  tile: Tile;
  state: TileState;
  /** The tile's rows, from buildPrSummary, in member order. */
  prs: PrSummary[];
  /** Every PR, events and user state whose turn may look at (at least the tile's members). */
  prsByKey: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  viewer: Viewer | null;
  /** PRs whose agent glance says NOT_YOURS (see `teamRequestHold`). */
  notYours?: ReadonlySet<PrKey>;
  pendingWrite: TilePendingWrite | null;
  quietRepo: boolean;
  repoLabel: string | null;
  /** Now, for what the tile would turn into once marked read (`afterRead`). */
  now: IsoTime;
}

/** The tile as the UI shows it: the rows plus the tile-wide chip, tier, people and whose turn. */
export function buildTileView(input: TileViewInput): TileView {
  const { tile, prs, viewer } = input;
  const memberPrs = tile.members.flatMap((member) => input.prsByKey.get(member.prKey) ?? []);
  const turn = whoseTurn({ tile, prs: input.prsByKey, events: input.events, userStates: input.userStates, viewer, notYours: input.notYours });
  const afterRead = tileAfterMarkRead({
    tile,
    prs: input.prsByKey,
    events: input.events,
    userStates: input.userStates,
    viewer,
    notYours: input.notYours,
    readAt: input.now,
  });
  return {
    tile,
    state: input.state,
    prs,
    why: tileWhy(prs.map((pr) => pr.why)),
    forWhom: tileForWhom(prs.map((pr) => pr.forWhom)),
    tier: tileTier(prs.map((pr) => pr.tier)),
    people: tilePeople(memberPrs, viewer?.login ?? null),
    turn,
    afterRead,
    pendingWrite: input.pendingWrite,
    offers: tileOffers({ tile, state: input.state, turn, afterRead, prs, pendingWrite: input.pendingWrite }),
    notDonePrKeys: notDonePrKeys({ state: input.state, prs }),
    quietRepo: input.quietRepo,
    repoLabel: input.repoLabel,
  };
}

/**
 * Where a tile goes in a topic's list, lowest first: unread, open, snoozed,
 * done. A read tile that is still the viewer's move ranks with the unread
 * ones, so marking it read never moves it down the list (2026-09-29).
 */
export function tileListRank(view: Pick<TileView, 'state' | 'turn'>): number {
  if (view.state.kind === 'open' && view.turn.kind === 'you') {
    return TILE_STATE_ORDER.unread;
  }
  return TILE_STATE_ORDER[view.state.kind];
}
