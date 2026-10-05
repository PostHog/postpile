// The hot board (DESIGN.md "Big inboxes: what PostPile loads and works
// on", 2026-10-05). Nothing stored ever ages out, so a board that read
// every stored PR grew with the inbox until the main process ran out of
// memory. PostPile only loads, and only works on, a recent and fresh slice:
// the hot PRs. Rules only, no IO: the store hands in cheap facts per PR
// (columns and joins, never the snapshot), these rules pick the keys.
import { isOwnTeam, sameLogin } from './mentions.ts';
import { isPrOwner, prOwners } from './pr-owners.ts';
import type { StackLayer } from './stacks.ts';
import { isHomeTeam } from './team-roles.ts';
import type { FoundVia, IsoTime, NotificationReason, NotificationThread, PrKey, PrState, Viewer } from './types.ts';

/** A merged, closed or quiet PR stays hot this long after its last activity. */
export const SETTLED_DAYS = 7;

/** The most PRs the board holds. Past it the inbox is busy: see `selectHotBoard`. */
export const HOT_BOARD_MAX_PRS = 1500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Who a PR is for, in the order PostPile works for them (owner decision
 * 2026-10-05): the user first, then their home team, then everyone else.
 */
export type HotTier = 'you' | 'team' | 'others';

const TIER_ORDER: Record<HotTier, number> = { you: 0, team: 1, others: 2 };

/**
 * A stored PR's header (the `pr` row, migration 028): its short columns,
 * without the snapshot in `pr_snapshot` (`PrRepo.listHeaders`). Enough for
 * stacks over every stored PR, the hot rules and the search, without
 * parsing a snapshot.
 */
export interface PrHeader extends StackLayer {
  title: string;
  author: string;
  assignees: string[];
  reviewerUsers: string[];
  reviewerTeams: string[];
  isDraft: boolean;
  headOid: string;
  /** When its newest stored event happened; null without events. */
  lastEventAt: IsoTime | null;
}

/** What the hot rules read of one stored PR. */
export interface HotFacts {
  key: PrKey;
  state: PrState;
  author: string;
  assignees: string[];
  /** Still-pending review requests: user logins. */
  reviewerUsers: string[];
  /** Still-pending review requests: "org/team-slug". */
  reviewerTeams: string[];
  /** The PR's notification thread, if it has one. */
  thread: { unread: boolean; reason: NotificationReason } | null;
  /** How the last full sync found it outside the inbox, if it did. */
  found: FoundVia | null;
  /**
   * Aimed at the viewer in person beyond what the other fields say: a
   * stored mention, reply or question to them, or the author answering
   * their changes request; or news on its thread the stored snapshot has
   * not seen that may be a review request for them (`threadNewsFacts`).
   */
  personalAsk: boolean;
  /** The newest of the PR's last update on GitHub, its newest stored event and its thread's last update. */
  activityAt: IsoTime;
}

/** Where a PR stands in line for the board: tier, then unread first, then newest activity first. */
export interface HotRank {
  key: PrKey;
  tier: HotTier;
  unread: boolean;
  activityAt: IsoTime;
}

/** The hot facts of a stored PR, from its header and what sits beside it. */
export function hotFactsOf(
  pr: PrHeader,
  parts: { thread: Pick<NotificationThread, 'unread' | 'reason' | 'updatedAt'> | null; found: FoundVia | null; personalAsk: boolean },
): HotFacts {
  const times = [pr.updatedAt, pr.lastEventAt, parts.thread?.updatedAt ?? null].filter((time): time is IsoTime => time !== null);
  return {
    key: pr.key,
    state: pr.state,
    author: pr.author,
    assignees: pr.assignees,
    reviewerUsers: pr.reviewerUsers,
    reviewerTeams: pr.reviewerTeams,
    thread: parts.thread === null ? null : { unread: parts.thread.unread, reason: parts.thread.reason },
    found: parts.found,
    personalAsk: parts.personalAsk,
    activityAt: times.reduce((newest, time) => (time > newest ? time : newest)),
  };
}

/**
 * A PR the sync has not stored yet, known from its thread (and the finder)
 * only: open, owners and reviewers unknown. A review request on it counts
 * as aimed at the user until the fetch says whether it was theirs or a
 * team's: missing a personal request costs more than one fetch too many.
 */
export function threadOnlyFacts(
  key: PrKey,
  thread: Pick<NotificationThread, 'unread' | 'reason' | 'updatedAt'>,
  found: FoundVia | null,
): HotFacts {
  return {
    key,
    state: 'OPEN',
    author: '',
    assignees: [],
    reviewerUsers: [],
    reviewerTeams: [],
    thread: { unread: thread.unread, reason: thread.reason },
    found,
    personalAsk: thread.reason === 'review_requested',
    activityAt: thread.updatedAt,
  };
}

/** A pending request on the PR is for the viewer in person or for one of their teams, home or routing. */
function requestedOfViewer(facts: HotFacts, viewer: Viewer): boolean {
  return facts.reviewerUsers.some((login) => sameLogin(login, viewer.login)) || facts.reviewerTeams.some((team) => isOwnTeam(team, viewer.teams));
}

/**
 * What the sync knows of a PR whose thread moved after its snapshot was
 * fetched: the stored facts with the thread as it is now, or the thread
 * alone for a PR not stored yet (`threadOnlyFacts`). The thread's reason is
 * the only word on news the snapshot has not seen, and one rule reads it
 * for every reason that may name the user: mention, assign and author make
 * tier you by the reason itself (`hotTier` reads the fresh thread). A
 * review_requested reason may be the user's or a team's: unless the stored
 * snapshot holds a pending request for the user or one of their teams that
 * explains it, it counts as a personal ask until the fetch says whose it
 * was. Before, a new direct request on a PR stored without one ranked by
 * the stale snapshot, and an old thread or a busy inbox shed it.
 */
export function threadNewsFacts(
  key: PrKey,
  stored: HotFacts | null,
  thread: Pick<NotificationThread, 'unread' | 'reason' | 'updatedAt'>,
  found: FoundVia | null,
  viewer: Viewer | null,
): HotFacts {
  if (stored === null) {
    return threadOnlyFacts(key, thread, found);
  }
  const facts = { ...stored, thread: { unread: thread.unread, reason: thread.reason } };
  const unexplainedRequest = thread.reason === 'review_requested' && (viewer === null || !requestedOfViewer(stored, viewer));
  return unexplainedRequest ? { ...facts, personalAsk: true } : facts;
}

/** The oldest activity a settled PR may have and still be hot. */
export function settledSince(now: IsoTime): IsoTime {
  return new Date(new Date(now).getTime() - SETTLED_DAYS * DAY_MS).toISOString();
}

/**
 * Hot by itself: its thread is unread on GitHub, or it is open and tracked
 * (a thread or a found PR), or it had activity in the last SETTLED_DAYS
 * (a merge or close counts: it moves the PR's last update). Stack layers
 * and set mates of a hot PR come along in `selectHotBoard`.
 */
export function isHotByRule(facts: HotFacts, since: IsoTime): boolean {
  const tracked = facts.thread !== null || facts.found !== null;
  return facts.thread?.unread === true || (facts.state === 'OPEN' && tracked) || facts.activityAt >= since;
}

/** Thread reasons that name the viewer in person: mentioned, assigned, their own PR. */
const YOU_REASONS: readonly NotificationReason[] = ['mention', 'assign', 'author'];

/** Found PRs that are the viewer's own, assigned to them or waiting on their review. */
const YOU_FOUND: readonly FoundVia[] = ['own_open', 'assigned', 'review_requested'];

function isForYou(facts: HotFacts, viewer: Viewer): boolean {
  return (
    isPrOwner(facts, viewer.login) ||
    facts.personalAsk ||
    facts.reviewerUsers.some((login) => sameLogin(login, viewer.login)) ||
    (facts.thread !== null && YOU_REASONS.includes(facts.thread.reason)) ||
    (facts.found !== null && YOU_FOUND.includes(facts.found))
  );
}

/** A home team is asked (routing-only teams do not count), or a home-team member owns the PR. */
function isForTeam(facts: HotFacts, viewer: Viewer): boolean {
  const teammates = viewer.teamMembers ?? [];
  return (
    facts.reviewerTeams.some((team) => isHomeTeam(team, viewer)) ||
    prOwners(facts).some((owner) => teammates.some((member) => sameLogin(member, owner)))
  );
}

/**
 * you: the viewer's own PR (author, or a bot PR assigned to them), a
 * review requested from them in person, a mention, reply or question to
 * them, their changes request answered. team: a request to one of their
 * home teams, or a PR a home-team member owns. others: everything else.
 * Without a stored viewer nothing is for anyone yet.
 */
export function hotTier(facts: HotFacts, viewer: Viewer | null): HotTier {
  if (viewer === null) {
    return 'others';
  }
  if (isForYou(facts, viewer)) {
    return 'you';
  }
  return isForTeam(facts, viewer) ? 'team' : 'others';
}

export function hotRank(facts: HotFacts, viewer: Viewer | null): HotRank {
  return { key: facts.key, tier: hotTier(facts, viewer), unread: facts.thread?.unread === true, activityAt: facts.activityAt };
}

/** Negative when `a` goes on the board before `b`. */
export function compareHotRank(a: HotRank, b: HotRank): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    Number(b.unread) - Number(a.unread) ||
    b.activityAt.localeCompare(a.activityAt) ||
    a.key.localeCompare(b.key)
  );
}

export interface HotBoardInput {
  facts: HotFacts[];
  /** PRs that only load together: every stack and every active set. Keys without facts are left out. */
  groups: PrKey[][];
  viewer: Viewer | null;
  now: IsoTime;
  /** Defaults to HOT_BOARD_MAX_PRS. */
  max?: number;
}

export interface HotSelection {
  /** The PRs the board loads. */
  keys: Set<PrKey>;
  /** PRs that would be hot without the cap: hot by rule, plus their stacks and sets. */
  inboxPrs: number;
  /** The hot set was over the cap: tier others got nothing, tiers you and team went by rank. */
  busy: boolean;
  /** Kept PRs by their own tier (a stack layer or set mate kept with a better PR counts in its own). */
  keptByTier: Record<HotTier, number>;
  /**
   * While busy and tiers you and team alone filled the cap: the last unit
   * kept. Anything that ranks after it would be cut. Null otherwise.
   */
  weakestKept: HotRank | null;
}

/** Union-find over keys: each group's keys end up in one unit. */
function unitsOf(keys: PrKey[], groups: PrKey[][]): Map<PrKey, PrKey[]> {
  const parent = new Map<PrKey, PrKey>(keys.map((key) => [key, key]));
  const root = (key: PrKey): PrKey => {
    let current = key;
    while (parent.get(current) !== current) {
      current = parent.get(current)!;
    }
    parent.set(key, current);
    return current;
  };
  for (const group of groups) {
    const present = group.filter((key) => parent.has(key));
    for (const key of present.slice(1)) {
      parent.set(root(key), root(present[0]!));
    }
  }
  const members = new Map<PrKey, PrKey[]>();
  for (const key of keys) {
    const top = root(key);
    const unit = members.get(top) ?? [];
    unit.push(key);
    members.set(top, unit);
  }
  const result = new Map<PrKey, PrKey[]>();
  for (const unit of members.values()) {
    for (const key of unit) {
      result.set(key, unit);
    }
  }
  return result;
}

/**
 * The seeds with every PR that loads together with them, transitively: a
 * stack layer brings its stack, a set member its set, and so on. What a
 * scoped load of a few PRs reads, so their stacks and sets show whole.
 */
export function withGroups(seeds: PrKey[], groups: PrKey[][]): Set<PrKey> {
  const groupsOf = new Map<PrKey, PrKey[][]>();
  for (const group of groups) {
    for (const key of group) {
      const of = groupsOf.get(key) ?? [];
      of.push(group);
      groupsOf.set(key, of);
    }
  }
  const result = new Set<PrKey>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (result.has(key)) {
      continue;
    }
    result.add(key);
    for (const group of groupsOf.get(key) ?? []) {
      queue.push(...group.filter((member) => !result.has(member)));
    }
  }
  return result;
}

interface RankedUnit {
  keys: PrKey[];
  rank: HotRank;
}

function countByTier(keys: Iterable<PrKey>, tiers: Map<PrKey, HotTier>): Record<HotTier, number> {
  const counts: Record<HotTier, number> = { you: 0, team: 0, others: 0 };
  for (const key of keys) {
    counts[tiers.get(key) ?? 'others'] += 1;
  }
  return counts;
}

/**
 * The hot board: every PR hot by rule (`isHotByRule`) with its whole stack
 * and set, so stacks and sets stay complete. When that is more than `max`
 * PRs the inbox is busy, and PostPile works for the user first, then their
 * team, and stops working for everyone else: units go on by their best
 * hot member's rank (`compareHotRank`), tier others gets nothing even if
 * room is left, and once the cap is reached the rest is cut. The last unit
 * may take the board a few PRs past the cap; a stack is never cut in two.
 */
export function selectHotBoard(input: HotBoardInput): HotSelection {
  const max = input.max ?? HOT_BOARD_MAX_PRS;
  const since = settledSince(input.now);
  const factsByKey = new Map(input.facts.map((facts) => [facts.key, facts]));
  const units = unitsOf([...factsByKey.keys()], input.groups);
  const tiers = new Map(input.facts.map((facts) => [facts.key, hotTier(facts, input.viewer)]));
  const ranked = new Map<PrKey[], HotRank>();
  for (const facts of input.facts) {
    if (!isHotByRule(facts, since)) {
      continue;
    }
    const unit = units.get(facts.key)!;
    const rank = hotRank(facts, input.viewer);
    const best = ranked.get(unit);
    if (best === undefined || compareHotRank(rank, best) < 0) {
      ranked.set(unit, rank);
    }
  }
  const hotUnits: RankedUnit[] = [...ranked].map(([keys, rank]) => ({ keys, rank }));
  const inboxPrs = hotUnits.reduce((sum, unit) => sum + unit.keys.length, 0);
  if (inboxPrs <= max) {
    const keys = new Set(hotUnits.flatMap((unit) => unit.keys));
    return { keys, inboxPrs, busy: false, keptByTier: countByTier(keys, tiers), weakestKept: null };
  }
  const keys = new Set<PrKey>();
  let lastKept: HotRank | null = null;
  for (const unit of hotUnits.sort((a, b) => compareHotRank(a.rank, b.rank))) {
    if (unit.rank.tier === 'others' || keys.size >= max) {
      break;
    }
    unit.keys.forEach((key) => keys.add(key));
    lastKept = unit.rank;
  }
  const weakestKept = keys.size >= max ? lastKept : null;
  return { keys, inboxPrs, busy: true, keptByTier: countByTier(keys, tiers), weakestKept };
}

/**
 * Whether a PR of this rank would make the board as it stands. A PR on the
 * board already is kept, whatever its own rank: a unit goes on by its best
 * member, so the weakest kept unit ranks equal to itself and a stack layer
 * or set mate may be of tier others. Any other PR: anything while the
 * inbox is not busy; while busy only tiers you and team, and once those
 * filled the cap only what ranks before the weakest unit kept (what ranks
 * after it would be cut again by the next load, `selectHotBoard`).
 */
export function wouldKeep(selection: Pick<HotSelection, 'busy' | 'weakestKept' | 'keys'>, rank: HotRank): boolean {
  if (!selection.busy || selection.keys.has(rank.key)) {
    return true;
  }
  return rank.tier !== 'others' && (selection.weakestKept === null || compareHotRank(rank, selection.weakestKept) < 0);
}

/** The board holds as many PRs as it may: a sync's backlog drain stops here, the rest would be cut. */
export function isBoardFull(selection: Pick<HotSelection, 'keys'>, max: number = HOT_BOARD_MAX_PRS): boolean {
  return selection.keys.size >= max;
}

/**
 * GET /api/busy-inbox: the sidebar card's numbers (UI to follow). busy:
 * the cap cut the hot set on the last load; settled PRs that went cold
 * never make it busy. inboxPrs: PRs that would be hot without the cap;
 * keptPrs: on the board; quietPrs: the difference, which PostPile does not
 * load, fetch or work on. updatesLastHour: PR threads with fresh activity
 * PostPile decided about in the last hour. writesLocked: GitHub writes are
 * off, so PostPile cannot shed load by marking things read.
 */
export interface BusyInboxView {
  busy: boolean;
  inboxPrs: number;
  keptPrs: number;
  quietPrs: number;
  cap: number;
  updatesLastHour: number;
  writesLocked: boolean;
  keptYou: number;
  keptTeam: number;
  keptOthers: number;
}

export function busyInboxView(
  selection: Pick<HotSelection, 'busy' | 'inboxPrs' | 'keptByTier'>,
  parts: { updatesLastHour: number; writesLocked: boolean; cap?: number },
): BusyInboxView {
  const { you, team, others } = selection.keptByTier;
  const keptPrs = you + team + others;
  return {
    busy: selection.busy,
    inboxPrs: selection.inboxPrs,
    keptPrs,
    quietPrs: Math.max(0, selection.inboxPrs - keptPrs),
    cap: parts.cap ?? HOT_BOARD_MAX_PRS,
    updatesLastHour: parts.updatesLastHour,
    writesLocked: parts.writesLocked,
    keptYou: you,
    keptTeam: team,
    keptOthers: others,
  };
}
