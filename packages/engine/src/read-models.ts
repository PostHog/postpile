import {
  isLiveProposal,
  archiveEndsAt,
  lastJoinAt,
  takesNewPrs,
  OUTSIDE_PROPOSAL_DAYS,
  proposalOutcome,
  proposalOutcomeAt,
  type TopicProposal,
  scopedSettings,
  type ListScope,
  glanceRefreshBlockOf,
  glanceStateOf,
  activityList,
  whatsNew,
  unreadPrKeysOf,
  agentOnlyApprovers,
  standingApprovals,
  viewerApproval,
  viewerReviewStand,
  agentPrFacts,
  buildPrSummary,
  buildTileView,
  topicAgentOffers,
  compareInSection,
  eventView,
  topicMove,
  isPrInQuietRepo,
  isQuietTile,
  isTopicInScope,
  labelBaseRepo,
  ownerRelation,
  pingedPrKeys,
  prTier,
  prPaneView,
  prStatus,
  prWhoseTurn,
  isReReviewMove,
  repoOverview,
  searchTopics,
  tileRepoLabels,
  topicRepoLine,
  tileListRank,
  topicFaces,
  topicPeople,
  topicQueues,
  topicUrgency,
  topicYourMoves,
  yourMovesByGroup,
  viewerOrgs,
  type FactQuery,
  type FactView,
  type FinishedTopic,
  type CatchUpRunState,
  type CleanupGlance,
  type Glance,
  type GlanceGap,
  type GlanceRefreshBlock,
  type GlanceState,
  type NotificationDebugRow,
  HANDLED_QUIETLY_DAYS,
  SET_CHANGES_SHOWN,
  pingDecisionsByThread,
  type QuietReadView,
  type Pr,
  type EventView,
  type PrDetail,
  type PrKey,
  type MacNotification,
  type PingTarget,
  type PrSummaryInput,
  type TilePendingWrite,
  type PrTier,
  type RepoOverview,
  type RepoSettings,
  type SearchableTopic,
  type SearchResult,
  type Tile,
  type TileView,
  type Topic,
  type TopicArchiveBox,
  type TopicDetail,
  openInDealtWith,
  topicPrRollup,
  topicDriverView,
  topicQuiet,
  topicSectionOf,
  type TopicListItem,
  type TopicQueues,
  type Viewer,
  type ViewerView,
  boardShapeEvents,
  busyInboxView,
  threadPrKey,
  prMatchesTerms,
  searchTerms,
  type BoardShapeEvent,
  type BusyInboxView,
  type PrHeader,
} from '@postpile/core';
import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from './board.ts';
import { RetireGate } from './consolidation/retire-gate.ts';
import { debugNotificationRows, quietReadViews } from './debug-notifications.ts';
import { glanceGapKey } from './digest/glance-batches.ts';
import { GlanceInputs, glanceTargetKeys } from './glance-inputs.ts';
import { MemoryReads } from './memory/memory-reads.ts';
import { placementOf } from './memory/placement.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { pingClickTargetOnBoard, placeOnBoard } from './live/ping-target.ts';
import { loadRepoSettings } from './repo-settings.ts';
import { loadViewer } from './viewer-meta.ts';
import { OpenedReadInputs } from './writes/opened-read-inputs.ts';
import type { PendingWrites } from './writes/pending-writes.ts';

function isUnsortedTopic(topicId: string): boolean {
  return topicId === UNSORTED_TOPIC_ID;
}

function memberKeys(tile: Tile): PrKey[] {
  return tile.members.map((member) => member.prKey);
}

/** The order inside each sidebar section (`compareInSection`), then Unsorted last, then by name. */
function compareTopics(a: TopicListItem, b: TopicListItem): number {
  const inSection = compareInSection(a, b);
  if (inSection !== 0) {
    return inSection;
  }
  // Unsorted goes last within its group so real topics come first.
  if ((a.topic.id === UNSORTED_TOPIC_ID) !== (b.topic.id === UNSORTED_TOPIC_ID)) {
    return a.topic.id === UNSORTED_TOPIC_ID ? 1 : -1;
  }
  return a.topic.name.localeCompare(b.topic.name);
}

/** What the glance state needs from outside the store: the agent switch, the catch-up runs and the daily catch-up cap. */
export interface GlanceStatusSource {
  agentOff(): boolean;
  /** A run for the PR's topic, or a glance-only run for the PR itself. Without a prKey: whole-topic runs only. */
  catchUp(topicId: string | null, prKey: PrKey | null): CatchUpRunState;
  /** The daily catch-up cap: 0 (catch-up off), or spent in its 24h window. */
  catchUpCap(): { off: boolean; spent: boolean };
}

const NO_GLANCE_STATUS: GlanceStatusSource = { agentOff: () => false, catchUp: () => null, catchUpCap: () => ({ off: true, spent: false }) };

/** Cold PRs one search reads at most (newest first), with their stacks and sets: a one-letter query must not read the whole store. */
export const SEARCH_COLD_MAX = 200;

const HOUR_MS = 60 * 60 * 1000;

/** Builds the API read models. Every call loads a fresh Board, so state is always derived. */
/**
 * The glance was written against an older dossier of its topic: current,
 * but a look rewrites it with the newer one (`GlanceInputs.behindDossier`).
 * Unsorted has no dossier, so never.
 */
function glanceBehindDossier(store: Store, topicId: string | null, glance: Glance | null): boolean {
  const latest = topicId === null ? null : (store.dossiers.latest(topicId)?.version ?? null);
  return glance !== null && latest !== null && (glance.dossierVersion ?? 0) < latest;
}

export class ReadModels {
  private readonly memory: MemoryReads;

  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
    private readonly pendingWrites: PendingWrites,
    private readonly glanceStatus: GlanceStatusSource = NO_GLANCE_STATUS,
  ) {
    this.memory = new MemoryReads(store, now);
  }

  /** The words the UI shows for a PR's glance (`glanceStateOf`). */
  private glanceState(board: Board, key: PrKey, parts: { hasGlance: boolean; stale: boolean; gap: GlanceGap | null; wanted: Set<PrKey> }): GlanceState {
    return glanceStateOf({
      hasGlance: parts.hasGlance,
      stale: parts.stale,
      wanted: parts.wanted.has(key),
      gap: parts.gap,
      agentOff: this.glanceStatus.agentOff(),
      catchUp: this.glanceStatus.catchUp(board.memberships.get(key)?.topicId ?? null, key),
    });
  }

  /** A whole-topic catch-up runs for the topic (null: Unsorted): its dossier and facts are being rewritten. */
  private memoryUpdating(topicId: string | null): boolean {
    return this.glanceStatus.catchUp(topicId, null) === 'running';
  }

  /** Whether looking at the PR rewrites a stale glance, or why not (`glanceRefreshBlockOf`). */
  private glanceRefreshBlock(key: PrKey, wanted: Set<PrKey>): GlanceRefreshBlock | null {
    const cap = this.glanceStatus.catchUpCap();
    return glanceRefreshBlockOf({ wanted: wanted.has(key), agentOff: this.glanceStatus.agentOff(), catchUpOff: cap.off, dailyCapSpent: cap.spent });
  }

  private board(): Board {
    return Board.load(this.store, this.now().toISOString());
  }

  /** The hot Board for its PRs, and one Board read for this request for those of `keys` that went cold. */
  private boardsFor(keys: PrKey[]): (key: PrKey) => Board {
    const hot = this.board();
    const cold = [...new Set(keys)].filter((key) => !hot.prs.has(key));
    const coldBoard = cold.length > 0 ? Board.forPrs(this.store, this.now().toISOString(), cold) : hot;
    return (key) => (hot.prs.has(key) ? hot : coldBoard);
  }

  /** The repo menu lists a topic when one of its PRs is in the chosen repo; its tiles are never narrowed. */
  private isListed(tiles: Tile[], settings: RepoSettings): boolean {
    return tiles.length > 0 && isTopicInScope(tiles.flatMap(memberKeys), settings);
  }

  /**
   * PRs whose stored glance no longer matches its current input: new commits,
   * a new dossier version, changed instructions or tailoring, new feedback.
   * The hash only stops a regeneration; this stops an old verdict being shown
   * next to Approve when the last sync skipped or failed the glance.
   */
  private staleGlances(board: Board, keys: PrKey[]): Set<PrKey> {
    const glances = this.store.glances.getMany(keys);
    const viewer = loadViewer(this.store);
    if (glances.size === 0 || !viewer) {
      return new Set(glances.keys());
    }
    const inputs = new GlanceInputs(this.store, board, viewer, this.contexts);
    const targets = new Map(inputs.targets().map((target) => [target.item.pr.key, target]));
    const stale = new Set<PrKey>();
    for (const [key, glance] of glances) {
      const target = targets.get(key);
      if (!target || !inputs.isCurrent(this.agent, target, glance)) {
        stale.add(key);
      }
    }
    return stale;
  }

  /**
   * The stored glances of these PRs, each with whether it is stale or a
   * catch-up rewrites it right now, for the inbox cleanup's "look safe"
   * item. Reads only: it never starts or queues a glance.
   */
  glancesNow(keys: PrKey[]): Map<PrKey, CleanupGlance> {
    const glances = this.store.glances.getMany(keys);
    if (glances.size === 0) {
      return new Map();
    }
    const board = this.board();
    const stale = this.staleGlances(board, [...glances.keys()]);
    const result = new Map<PrKey, CleanupGlance>();
    for (const [key, glance] of glances) {
      const writing = this.glanceStatus.catchUp(board.memberships.get(key)?.topicId ?? null, key) === 'running';
      result.set(key, { verdict: glance.verdict, stale: stale.has(key), writing });
    }
    return result;
  }

  /** Why a PR without a glance has none, as the last sync recorded it. Null once a glance exists. */
  private glanceGap(key: PrKey, hasGlance: boolean): GlanceGap | null {
    const raw = hasGlance ? null : this.store.meta.get(glanceGapKey(key));
    return raw === null ? null : (JSON.parse(raw) as GlanceGap);
  }

  /** The PR's queue; without a stored viewer nothing is aimed at anyone yet, so rest. */
  private tierOf(board: Board, pr: Pr, viewer: Viewer | null): PrTier {
    if (!viewer) {
      return 'rest';
    }
    const reason = board.threads.get(pr.key)?.reason ?? null;
    return prTier({ pr, events: board.events.get(pr.key) ?? [], viewer, userState: board.userStates.get(pr.key) ?? null, reason });
  }

  /** The PR's move is a re-review, which sorts it first under Changes you requested. */
  private isReReview(board: Board, pr: Pr, viewer: Viewer | null): boolean {
    if (!viewer) {
      return false;
    }
    const turn = prWhoseTurn({ pr, events: board.events.get(pr.key) ?? [], userState: board.userStates.get(pr.key) ?? null, viewer, notYours: board.notYours.has(pr.key) });
    return isReReviewMove(turn);
  }

  /** The inputs of the tile's rows, gathered from the board and the store: the rows (`buildPrSummary`) and the agent's facts (`agentPrFacts`) read them. */
  private prSummaryInputs(
    board: Board,
    tile: Tile,
    stale: Set<PrKey>,
    viewer: Viewer | null,
    settings: RepoSettings,
    repoLabels: (string | null)[],
    tileUnread: boolean,
    wanted: Set<PrKey>,
    pending: Map<PrKey, TilePendingWrite>,
    opened: OpenedReadInputs,
  ): PrSummaryInput[] {
    const glances = this.store.glances.getMany(tile.members.map((m) => m.prKey));
    return tile.members.flatMap((member, index): PrSummaryInput[] => {
      const pr = board.prs.get(member.prKey);
      if (!pr) {
        return [];
      }
      const glance = glances.get(pr.key) ?? null;
      const gap = this.glanceGap(pr.key, glance !== null);
      return [
        {
          pr,
          member,
          viewer,
          userState: board.userStates.get(pr.key) ?? null,
          events: board.events.get(pr.key) ?? [],
          reason: board.threads.get(pr.key)?.reason ?? null,
          glance,
          glanceStale: stale.has(pr.key),
          glanceGap: gap,
          glanceState: this.glanceState(board, pr.key, { hasGlance: glance !== null, stale: stale.has(pr.key), gap, wanted }),
          glanceRefreshBlock: this.glanceRefreshBlock(pr.key, wanted),
          quietRepo: isPrInQuietRepo(pr.key, settings),
          repoLabel: repoLabels[index] ?? null,
          tileUnread,
          unreadOnGitHub: board.threads.get(pr.key)?.unread === true,
          lastReadAt: board.threads.get(pr.key)?.lastReadAt ?? null,
          now: board.now,
          pendingWrite: pending.get(pr.key) ?? null,
          opened: opened.of(pr.key),
        },
      ];
    });
  }

  private tileViews(board: Board, topicId: string): TileView[] {
    const settings = loadRepoSettings(this.store);
    // An opened topic shows every tile; the repo scope only labels the ones from another repo.
    const tiles = board.tilesForTopic(topicId);
    const stale = this.staleGlances(board, tiles.flatMap((tile) => tile.members.map((m) => m.prKey)));
    const wanted = glanceTargetKeys(board);
    const viewer = loadViewer(this.store);
    const pending = this.pendingWrites.byPrKey();
    const baseRepo = labelBaseRepo(tiles.flatMap(memberKeys), settings);
    const orgs = viewerOrgs(viewer?.teams ?? []);
    const opened = new OpenedReadInputs(board, this.store);
    const views = tiles.map((tile): TileView => {
      const labels = tileRepoLabels(memberKeys(tile), baseRepo, orgs);
      const state = board.stateOf(tile);
      const rows = this.prSummaryInputs(board, tile, stale, viewer, settings, labels.prs, state.kind === 'unread', wanted, pending, opened);
      return buildTileView({
        tile,
        state,
        prs: rows.map(buildPrSummary),
        agentPrs: rows.map(agentPrFacts),
        prsByKey: board.prs,
        events: board.events,
        userStates: board.userStates,
        viewer,
        notYours: board.notYours,
        pendingWrite: tile.members.map((member) => pending.get(member.prKey)).find((mark) => mark !== undefined) ?? null,
        quietRepo: isQuietTile(memberKeys(tile), settings),
        repoLabel: labels.tile,
        now: board.now,
      });
    });
    return views.sort((a, b) => tileListRank(a) - tileListRank(b));
  }

  /**
   * The current views of the tiles `wanted` picks, built like an opened
   * topic's. The agent actions re-check their offers against them at click time.
   */
  currentTileViews(wanted: (tile: Tile) => boolean): TileView[] {
    const board = this.board();
    const topicIds = [...new Set(board.allTiles().filter(wanted).map((tile) => tile.topicId))];
    return topicIds.flatMap((topicId) => this.tileViews(board, topicId)).filter((view) => wanted(view.tile));
  }

  /** The topic's PRs per tier and by author (`topicQueues`): the list row and the opened topic read the same numbers. */
  private topicQueuesOf(board: Board, tiles: Tile[], prs: Pr[], viewer: Viewer | null, settings: RepoSettings): TopicQueues {
    const pinged = pingedPrKeys(tiles);
    return topicQueues(
      prs.map((pr) => ({
        tier: this.tierOf(board, pr, viewer),
        author: ownerRelation(pr, viewer),
        state: pr.state,
        pulledIn: !pinged.has(pr.key),
        quiet: isPrInQuietRepo(pr.key, settings),
        changesAddressed: this.isReReview(board, pr, viewer),
      })),
    );
  }

  /** Each PR of the topic's tiles once, in tile order. */
  private topicPrs(board: Board, tiles: Tile[]): Pr[] {
    const prs = new Map<PrKey, Pr>();
    for (const member of tiles.flatMap((tile) => tile.members)) {
      const pr = board.prs.get(member.prKey);
      if (pr && !prs.has(pr.key)) {
        prs.set(pr.key, pr);
      }
    }
    return [...prs.values()];
  }

  unreadPrKeys(): PrKey[] {
    const board = this.board();
    const unread = board.allTiles().filter((tile) => board.stateOf(tile).kind === 'unread');
    return [...new Set(unread.flatMap(memberKeys))];
  }

  /** Distinct tiles holding these PRs now (the Dock badge); a PR in no tile counts on its own. */
  tilesHolding(prKeys: PrKey[]): number {
    const board = this.board();
    return new Set(prKeys.map((key) => placeOnBoard(board, key)?.tile?.id ?? `pr:${key}`)).size;
  }

  /** A cold PR's place comes from a Board of its topic, read for this click. */
  pingClickTarget(notification: Pick<MacNotification, 'target' | 'prKeys'>): PingTarget | null {
    const now = this.now().toISOString();
    return pingClickTargetOnBoard(this.board(), notification, (key) => Board.forPr(this.store, now, key));
  }

  /**
   * The busy inbox card's numbers (`busyInboxView`), from what picked the
   * last hot Board: no load of its own once any read loaded one.
   */
  busyInbox(writesLocked: boolean): BusyInboxView {
    if (Board.lastSelection(this.store) === null) {
      // Nothing loaded a Board in this process yet.
      this.board();
    }
    const selection = Board.lastSelection(this.store) ?? { busy: false, inboxPrs: 0, keptByTier: { you: 0, team: 0, others: 0 } };
    const since = new Date(this.now().getTime() - HOUR_MS).toISOString();
    const updatesLastHour = this.store.notifications.countPrThreadsUpdatedSince(since);
    return busyInboxView(selection, { updatesLastHour, writesLocked });
  }

  /** The topics the sidebar lists with all repos, each with its tiles. */
  boardShape(): BoardShapeEvent[] {
    const board = this.board();
    const settings = scopedSettings(loadRepoSettings(this.store), { allRepos: true });
    const listed = board.topics().map((topic) => ({ topic, tiles: board.tilesForTopic(topic.id) }));
    return boardShapeEvents(listed.filter(({ tiles }) => this.isListed(tiles, settings)));
  }

  listTopics(scope?: ListScope): TopicListItem[] {
    const board = this.board();
    const topics = board.topics();
    const dossiers = this.store.dossiers.latestMany(topics.map((topic) => topic.id));
    const driverPicks = this.store.driverPicks.all();
    const viewer = loadViewer(this.store);
    const settings = scopedSettings(loadRepoSettings(this.store), scope);
    const items: TopicListItem[] = [];
    for (const topic of topics) {
      const tiles = board.tilesForTopic(topic.id);
      if (!this.isListed(tiles, settings)) {
        continue;
      }
      const states = tiles.map((tile) => board.stateOf(tile).kind);
      const urgency = topicUrgency(
        tiles.map((tile, index) => {
          const turn = board.turnOf(tile);
          const state = board.stateOf(tile);
          const loudMembers = tile.members.filter((member) => !isPrInQuietRepo(member.prKey, settings));
          return {
            state: states[index] ?? 'open',
            unreadOnGitHub: state.unreadOnGitHub,
            loud: state.loud,
            unreadPrKeys: unreadPrKeysOf(
              state,
              tile.members.map((member) => member.prKey).filter((key) => board.threads.get(key)?.unread === true),
            ),
            prStates: loudMembers.flatMap((member) => board.prs.get(member.prKey)?.state ?? []),
            move: topicMove(turn),
            quiet: isQuietTile(memberKeys(tile), settings),
          };
        }),
      );
      const prs = this.topicPrs(board, tiles);
      const queues = this.topicQueuesOf(board, tiles, prs, viewer, settings);
      const prRollup = topicPrRollup(tiles, prs);
      const latest = dossiers.get(topic.id);
      const dossier = latest?.dossier;
      const placement = isUnsortedTopic(topic.id) ? null : placementOf(this.store, topic, latest);
      const section = topicSectionOf({ topic, driverPick: driverPicks.get(topic.id) ?? null, queues, moves: urgency.yourMoves.length, placement, viewer });
      const unseenMergeTiles = tiles.filter((tile) => (board.stateOf(tile).unseenMerges?.length ?? 0) > 0).length;
      items.push({
        topic,
        placement,
        statusLine: dossier ? { status: dossier.status, note: dossier.statusNote } : null,
        group: urgency.needsYou ? 'needs_you' : 'quiet',
        unreadTiles: urgency.unreadTiles,
        unreadPrs: urgency.unreadPrs,
        unreadPrKeys: urgency.unreadPrKeys,
        urgentUnreadTiles: urgency.urgentUnreadTiles,
        openTiles: states.filter((kind) => kind === 'open').length,
        totalTiles: states.length,
        yourMoves: urgency.yourMoves,
        unseenMergeTiles,
        queues,
        quiet: topicQuiet({ section, unreadTiles: urgency.unreadTiles, moves: urgency.yourMoves.length, unseenMergeTiles }),
        section,
        people: topicFaces(topicPeople(prs, viewer)),
        prState: prRollup.state,
        prStateCounts: prRollup.counts,
      });
    }
    return items.sort(compareTopics);
  }

  /**
   * The sidebar's Archive drawer: retired topics that still take new PRs
   * (`takesNewPrs`), newest first. Ignores the repo scope.
   */
  listFinishedTopics(): FinishedTopic[] {
    const now = this.now();
    return this.store.topics
      .list()
      .filter((topic) => topic.status === 'retired')
      .map((topic) => ({ topic, memberships: this.store.memberships.listForTopic(topic.id) }))
      .filter(({ topic, memberships }) => takesNewPrs(topic, lastJoinAt(memberships), now))
      .map(({ topic, memberships }) => ({
        id: topic.id,
        name: topic.name,
        area: topic.area,
        retiredAt: topic.retiredAt ?? topic.updatedAt,
        prCount: memberships.length,
      }))
      .sort((a, b) => b.retiredAt.localeCompare(a.retiredAt));
  }

  /** The title bar's repo menu: topics and PRs per repo, counted over every topic, not the scope. */
  repos(): RepoOverview {
    const board = this.board();
    const topicsPrKeys = board.topics().map((topic) => board.tilesForTopic(topic.id).flatMap(memberKeys));
    return repoOverview(topicsPrKeys, loadRepoSettings(this.store));
  }

  /** The stored viewer for the sidebar's filter buttons. */
  viewer(): ViewerView {
    const viewer = loadViewer(this.store);
    return { login: viewer?.login ?? null, teamMembers: viewer?.teamMembers ?? [], homeTeams: viewer?.homeTeams ?? null };
  }

  /** Decided or expired in the last OUTSIDE_PROPOSAL_DAYS days, newest first; merges into this topic included. */
  private decidedProposals(topicId: string, now: string): TopicProposal[] {
    const since = new Date(Date.parse(now) - OUTSIDE_PROPOSAL_DAYS * 24 * 3600_000).toISOString();
    const expired = this.store.proposals
      .listPendingForTopic(topicId)
      .filter((proposal) => proposalOutcome(proposal, now) === 'expired' && (proposalOutcomeAt(proposal, now) ?? '') >= since);
    const decided = this.store.proposals.listDecidedForTopic(topicId, since);
    return [...decided, ...expired].sort((a, b) => (proposalOutcomeAt(b, now) ?? '').localeCompare(proposalOutcomeAt(a, now) ?? ''));
  }

  /** The Archive box under the Tiles count (`TopicArchiveBox`); never for Unsorted. */
  private archiveBox(board: Board, topic: Topic): TopicArchiveBox | null {
    if (topic.id === UNSORTED_TOPIC_ID) {
      return null;
    }
    if (topic.status === 'retired') {
      const until = archiveEndsAt(topic, lastJoinAt(this.store.memberships.listForTopic(topic.id)));
      return until !== null && topic.retiredAt !== null ? { state: 'archived', at: topic.retiredAt, until } : null;
    }
    const at = topic.status === 'active' ? new RetireGate(board).archivesAt(topic.id) : null;
    return at === null ? null : { state: 'ready', at };
  }

  /** The topic whole: from the hot Board, or a Board of its PRs read for this request when some went cold (`Board.forTopic`). */
  getTopic(topicId: string): TopicDetail | null {
    const now = this.now().toISOString();
    const board = Board.forTopic(this.store, now, topicId);
    const topic = board.topic(topicId);
    if (!topic) {
      return null;
    }
    const isUnsorted = topicId === UNSORTED_TOPIC_ID;
    const tiles = this.tileViews(board, topicId);
    const topicTiles = board.tilesForTopic(topicId);
    const prs = this.topicPrs(board, topicTiles);
    const viewer = loadViewer(this.store);
    const settings = loadRepoSettings(this.store);
    const queues = this.topicQueuesOf(board, topicTiles, prs, viewer, settings);
    const placement = isUnsorted ? null : placementOf(this.store, topic, this.store.dossiers.latest(topicId) ?? undefined);
    const yourMoves = topicYourMoves(tiles);
    const sectionSource = { topic, driverPick: this.store.driverPicks.get(topicId), queues, moves: yourMoves.length, placement, viewer };
    return {
      topic,
      driver: isUnsorted ? null : topicDriverView(sectionSource),
      placement,
      repoLine: isUnsorted ? null : topicRepoLine(topicTiles.flatMap(memberKeys), settings, viewerOrgs(viewer?.teams ?? [])),
      tiles,
      yourMoves,
      groupYourMoves: yourMovesByGroup(tiles),
      sets: isUnsorted ? [] : this.store.sets.listActiveForTopic(topicId),
      setChanges: isUnsorted ? [] : this.store.sets.listChangesForTopic(topicId, SET_CHANGES_SHOWN),
      pendingProposals: isUnsorted ? [] : this.store.proposals.listPendingForTopic(topicId).filter((proposal) => isLiveProposal(proposal, now)),
      decidedProposals: isUnsorted ? [] : this.decidedProposals(topicId, now),
      dossier: isUnsorted ? null : this.memory.dossierView(topicId, board.prs),
      agent: topicAgentOffers(tiles),
      archive: this.archiveBox(board, topic),
      openInDealtWith: openInDealtWith(tiles),
      prRollup: topicPrRollup(topicTiles, prs),
      section: topicSectionOf(sectionSource),
      memoryUpdating: this.memoryUpdating(isUnsorted ? null : topicId),
    };
  }

  /** Debug view: the newest `limit` stored notification threads and where each landed. */
  debugNotifications(limit: number): NotificationDebugRow[] {
    const actions = {
      byThread: this.store.actionLog.latestByThread(),
      byPrKey: this.store.actionLog.latestByPrKey(),
      firstOfBatch: this.store.actionLog.firstOfBatches(),
    };
    const threads = this.store.notifications.list().slice(0, limit);
    const decisions = pingDecisionsByThread(this.store.pingDecisions.listForThreads(threads.map((thread) => thread.id)));
    return debugNotificationRows(this.boardsFor(threads.flatMap((thread) => threadPrKey(thread) ?? [])), threads, actions, decisions);
  }

  /** "Handled quietly": the quiet mark-reads of the last HANDLED_QUIETLY_DAYS days, newest first. */
  handledQuietly(): QuietReadView[] {
    const since = new Date(this.now().getTime() - HANDLED_QUIETLY_DAYS * 24 * 3600_000).toISOString();
    const entries = this.store.actionLog.listByOriginSince('quiet', since);
    const titles = new Map(this.store.notifications.list().map((thread) => [thread.id, thread.title]));
    return quietReadViews(this.boardsFor(entries.flatMap((entry) => entry.prKey ?? [])), entries, titles);
  }

  /**
   * The listed topics' PRs that went cold and match every term, matched on
   * their headers; at most SEARCH_COLD_MAX, newest first.
   */
  private coldMatches(board: Board, listed: Topic[], terms: string[]): PrKey[] {
    const headers = new Map<PrKey, PrHeader>(this.store.prs.listHeaders().map((pr) => [pr.key, pr]));
    const matches: PrHeader[] = [];
    for (const topic of listed) {
      for (const membership of topic.id === UNSORTED_TOPIC_ID ? [] : this.store.memberships.listForTopic(topic.id)) {
        const pr = headers.get(membership.prKey);
        if (pr && !board.prs.has(pr.key) && prMatchesTerms(topic, pr, terms)) {
          matches.push(pr);
        }
      }
    }
    return matches
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SEARCH_COLD_MAX)
      .map((pr) => pr.key);
  }

  /**
   * Search bar filter over the PRs of the topics the sidebar lists, each
   * with all its tiles, like an opened topic (`Board.forTopic`): the hot
   * Board's tiles, plus the tiles of matching PRs that went cold, read for
   * this request with their stacks and sets so their tile ids are the ones
   * the opened topic shows.
   */
  search(query: string, scope?: ListScope): SearchResult {
    const board = this.board();
    const settings = scopedSettings(loadRepoSettings(this.store), scope);
    const listed = board.topics().filter((topic) => this.isListed(board.tilesForTopic(topic.id), settings));
    const terms = searchTerms(query);
    const cold = terms.length === 0 ? [] : this.coldMatches(board, listed, terms);
    const coldBoard = cold.length > 0 ? Board.forPrs(this.store, this.now().toISOString(), cold) : null;
    const searchable = (from: Board, tiles: Tile[]) =>
      tiles.map((tile) => ({
        tileId: tile.id,
        prs: tile.members.flatMap((member) => {
          const pr = from.prs.get(member.prKey);
          return pr ? [{ key: pr.key, title: pr.title, author: pr.author, headRef: pr.headRef }] : [];
        }),
      }));
    const topics: SearchableTopic[] = listed.map((topic) => ({
      topicId: topic.id,
      name: topic.name,
      area: topic.area,
      tiles: [
        ...searchable(board, board.tilesForTopic(topic.id)),
        ...(coldBoard && topic.id !== UNSORTED_TOPIC_ID ? searchable(coldBoard, coldBoard.tilesForTopic(topic.id)) : []),
      ],
    }));
    return searchTopics(topics, query);
  }

  /** A cold PR is read with its topic for this request (`Board.forPr`). */
  getPr(key: PrKey): PrDetail | null {
    const board = Board.forPr(this.store, this.now().toISOString(), key);
    const pr = board.prs.get(key);
    if (!pr) {
      return null;
    }
    const glance = this.store.glances.get(key);
    const tileIds = new Set(
      board
        .allTiles()
        .filter((tile) => tile.members.some((m) => m.prKey === key))
        .map((tile) => tile.id),
    );
    const events = (board.events.get(key) ?? []).map(eventView);
    const viewer = loadViewer(this.store);
    const news = whatsNew(pr, board.events.get(key) ?? [], viewer);
    const stale = this.staleGlances(board, [key]).has(key);
    const gap = this.glanceGap(key, glance !== null);
    const wanted = glanceTargetKeys(board);
    return {
      pr: prPaneView(pr),
      status: prStatus(pr),
      fetchedAt: this.store.prs.fetchedAt(key),
      activity: activityList(events, viewer, news?.anchor.at ?? null, pr, board.threads.get(key) ?? null),
      whatsNew: news,
      glance,
      glanceStale: stale,
      glanceBehindDossier: glanceBehindDossier(this.store, board.memberships.get(key)?.topicId ?? null, glance),
      glanceGap: gap,
      glanceState: this.glanceState(board, key, { hasGlance: glance !== null, stale, gap, wanted }),
      glanceRefreshBlock: this.glanceRefreshBlock(key, wanted),
      memoryUpdating: this.memoryUpdating(board.memberships.get(key)?.topicId ?? null),
      userState: board.userStates.get(key) ?? null,
      viewerApproval: viewerApproval(pr, board.userStates.get(key) ?? null, loadViewer(this.store)?.login),
      viewerReview: viewerReviewStand(pr, viewer),
      agentApprovers: agentOnlyApprovers(standingApprovals(pr)),
      topicId: board.topicIdOf(key),
      tileIds: [...tileIds],
      facts: this.memory.prFacts(key),
    };
  }

  /** Every stored event of a PR, oldest first, with its display state: the CLI's `pr` command. The pane reads `activity`. */
  listPrEvents(key: PrKey): EventView[] {
    return this.store.events.listForPr(key).map(eventView);
  }

  listFacts(query: FactQuery): FactView[] {
    return this.memory.listFacts(query);
  }
}
