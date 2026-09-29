// The PR rows and the tile view the UI gets, built from gathered inputs. The
// engine and FakeEngine only collect the inputs (store or sample data); the
// rules that turn them into a view live here, once.
import { prAfterMarkRead, tileAfterMarkRead } from './after-read.ts';
import { forWhom, tileForWhom } from './for-whom.ts';
import { isUnseenLoud } from './loudness.ts';
import { prStatus, openThreadCount } from './pr-status.ts';
import { prTier } from './pr-tier.ts';
import { prPrimaryAction } from './primary-action.ts';
import { isApprovedByViewer } from './review-request.ts';
import { tilePeople } from './tile-people.ts';
import { isTracked } from './provenance.ts';
import { isPrDone, TILE_STATE_ORDER } from './tiles.ts';
import { memberTier, personRelation, tileTier } from './topic-queues.ts';
import type { Glance, IsoTime, NotificationReason, Pr, PrEvent, PrKey, Tile, TileMember, TileState, UserPrState, Viewer } from './types.ts';
import type { GlanceState } from './glance-state.ts';
import type { GlanceGap, PrSummary, TilePendingWrite, TileView } from './views.ts';
import { whatsNew } from './whats-new.ts';
import { NO_TURN, prWhoseTurn, whoseTurn } from './whose-turn.ts';
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
  /** Now, for what the PR would turn into once marked read (`afterRead`). */
  now: IsoTime;
}

/** One PR row of a tile. */
export function buildPrSummary(input: PrSummaryInput): PrSummary {
  const { pr, member, viewer, userState, events } = input;
  const authorRelation = personRelation(pr.author, viewer);
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
    done: isPrDone(pr, userState, viewer, events, notYours),
    turn: viewer ? prWhoseTurn({ pr, events, userState, viewer, notYours }) : NO_TURN,
    afterRead: prAfterMarkRead({ pr, events, userState, viewer, notYours, tracked: isTracked(member.provenance), readAt: input.now }),
    whatsNew: member.provenance.kind === 'found' ? null : whatsNew(pr, events, viewer),
    updatedAt: pr.updatedAt,
    quietRepo: input.quietRepo,
    repoLabel: input.repoLabel,
  };
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
  return {
    tile,
    state: input.state,
    prs,
    why: tileWhy(prs.map((pr) => pr.why)),
    forWhom: tileForWhom(prs.map((pr) => pr.forWhom)),
    tier: tileTier(prs.map((pr) => pr.tier)),
    people: tilePeople(memberPrs, viewer?.login ?? null),
    turn: whoseTurn({ tile, prs: input.prsByKey, events: input.events, userStates: input.userStates, viewer, notYours: input.notYours }),
    afterRead: tileAfterMarkRead({
      tile,
      prs: input.prsByKey,
      events: input.events,
      userStates: input.userStates,
      viewer,
      notYours: input.notYours,
      readAt: input.now,
    }),
    pendingWrite: input.pendingWrite,
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
