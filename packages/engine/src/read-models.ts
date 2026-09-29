import {
  scopedSettings,
  type ListScope,
  glanceStateOf,
  activityList,
  whatsNew,
  agentOnlyApprovers,
  standingApprovals,
  viewerApproval,
  buildPrSummary,
  buildTileView,
  compareTopicUrgency,
  displayState,
  FINISHED_TOPICS_MS,
  topicMove,
  isPrInQuietRepo,
  isQuietTile,
  isTopicInScope,
  labelBaseRepo,
  personRelation,
  pingedPrKeys,
  prTier,
  changesAnswered,
  repoOverview,
  searchTopics,
  tileRepoLabels,
  tileListRank,
  topicFaces,
  topicPeople,
  topicQueues,
  topicUrgency,
  viewerOrgs,
  whoseTurn,
  type FactQuery,
  type FactView,
  type FinishedTopic,
  type CatchUpRunState,
  type GlanceGap,
  type GlanceState,
  type NotificationDebugRow,
  HANDLED_QUIETLY_DAYS,
  pingDecisionsByThread,
  type QuietReadView,
  type Pr,
  type PrDetail,
  type PrKey,
  type PrSummary,
  type PrTier,
  type RepoOverview,
  type RepoSettings,
  type SearchableTopic,
  type SearchResult,
  type Tile,
  type TileView,
  type TopicDetail,
  type TopicListItem,
  type Viewer,
  type ViewerView,
} from '@postpile/core';
import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from './board.ts';
import { debugNotificationRows, quietReadViews } from './debug-notifications.ts';
import { glanceGapKey } from './digest/glance-batches.ts';
import { GlanceInputs, glanceTargetKeys } from './glance-inputs.ts';
import { MemoryReads } from './memory/memory-reads.ts';
import { placementOf } from './memory/placement.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { loadRepoSettings } from './repo-settings.ts';
import { loadViewer } from './viewer-meta.ts';
import type { PendingWrites } from './writes/pending-writes.ts';

function isUnsortedTopic(topicId: string): boolean {
  return topicId === UNSORTED_TOPIC_ID;
}

function memberKeys(tile: Tile): PrKey[] {
  return tile.members.map((member) => member.prKey);
}

function compareTopics(a: TopicListItem, b: TopicListItem): number {
  const byUrgency = compareTopicUrgency(a, b);
  if (byUrgency !== 0) {
    return byUrgency;
  }
  // Unsorted goes last within its group so real topics come first.
  if ((a.topic.id === UNSORTED_TOPIC_ID) !== (b.topic.id === UNSORTED_TOPIC_ID)) {
    return a.topic.id === UNSORTED_TOPIC_ID ? 1 : -1;
  }
  return a.topic.name.localeCompare(b.topic.name);
}

/** What the glance state needs from outside the store: the agent switch and the catch-up runs. */
export interface GlanceStatusSource {
  agentOff(): boolean;
  catchUp(topicId: string | null): CatchUpRunState;
}

const NO_GLANCE_STATUS: GlanceStatusSource = { agentOff: () => false, catchUp: () => null };

/** Builds the API read models. Every call loads a fresh Board, so state is always derived. */
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
      catchUp: this.glanceStatus.catchUp(board.memberships.get(key)?.topicId ?? null),
    });
  }

  private board(): Board {
    return Board.load(this.store, this.now().toISOString());
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
      if (!target || glance.inputHash !== inputs.itemHash(this.agent, target)) {
        stale.add(key);
      }
    }
    return stale;
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

  /** The tile's rows: gathers each member's inputs from the board and the store. */
  private prSummaries(
    board: Board,
    tile: Tile,
    stale: Set<PrKey>,
    viewer: Viewer | null,
    settings: RepoSettings,
    repoLabels: (string | null)[],
    tileUnread: boolean,
    wanted: Set<PrKey>,
  ): PrSummary[] {
    const glances = this.store.glances.getMany(tile.members.map((m) => m.prKey));
    return tile.members.flatMap((member, index) => {
      const pr = board.prs.get(member.prKey);
      if (!pr) {
        return [];
      }
      const glance = glances.get(pr.key) ?? null;
      const gap = this.glanceGap(pr.key, glance !== null);
      return [
        buildPrSummary({
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
          quietRepo: isPrInQuietRepo(pr.key, settings),
          repoLabel: repoLabels[index] ?? null,
          tileUnread,
          now: board.now,
        }),
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
    const views = tiles.map((tile): TileView => {
      const labels = tileRepoLabels(memberKeys(tile), baseRepo, orgs);
      const state = board.stateOf(tile);
      return buildTileView({
        tile,
        state,
        prs: this.prSummaries(board, tile, stale, viewer, settings, labels.prs, state.kind === 'unread', wanted),
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

  listTopics(scope?: ListScope): TopicListItem[] {
    const board = this.board();
    const topics = board.topics();
    const dossiers = this.store.dossiers.latestMany(topics.map((topic) => topic.id));
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
          const turn = whoseTurn({ tile, prs: board.prs, events: board.events, userStates: board.userStates, viewer, notYours: board.notYours });
          const loudMembers = tile.members.filter((member) => !isPrInQuietRepo(member.prKey, settings));
          return {
            state: states[index] ?? 'open',
            prStates: loudMembers.flatMap((member) => board.prs.get(member.prKey)?.state ?? []),
            move: topicMove(turn),
            quiet: isQuietTile(memberKeys(tile), settings),
          };
        }),
      );
      const prs = this.topicPrs(board, tiles);
      const pinged = pingedPrKeys(tiles);
      const latest = dossiers.get(topic.id);
      const dossier = latest?.dossier;
      items.push({
        topic,
        placement: isUnsortedTopic(topic.id) ? null : placementOf(this.store, topic, latest),
        statusLine: dossier ? { status: dossier.status, note: dossier.statusNote } : null,
        group: urgency.needsYou ? 'needs_you' : 'quiet',
        unreadTiles: urgency.unreadTiles,
        urgentUnreadTiles: urgency.urgentUnreadTiles,
        openTiles: states.filter((kind) => kind === 'open').length,
        totalTiles: states.length,
        yourMoves: urgency.yourMoves,
        unseenMergeTiles: tiles.filter((tile) => (board.stateOf(tile).unseenMerges?.length ?? 0) > 0).length,
        queues: topicQueues(
          prs.map((pr) => ({
            tier: this.tierOf(board, pr, viewer),
            author: personRelation(pr.author, viewer),
            state: pr.state,
            pulledIn: !pinged.has(pr.key),
            quiet: isPrInQuietRepo(pr.key, settings),
            changesAddressed: viewer !== null && changesAnswered(pr, viewer) !== null,
          })),
        ),
        people: topicFaces(topicPeople(prs, viewer)),
      });
    }
    return items.sort(compareTopics);
  }

  /** The sidebar's Finished drawer: topics retired in the last 30 days, newest first. Ignores the repo scope. */
  listFinishedTopics(): FinishedTopic[] {
    const since = new Date(this.now().getTime() - FINISHED_TOPICS_MS).toISOString();
    return this.store.topics
      .list()
      .filter((topic) => topic.status === 'retired' && topic.updatedAt >= since)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        area: topic.area,
        retiredAt: topic.updatedAt,
        prCount: this.store.memberships.listForTopic(topic.id).length,
      }));
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
    return { login: viewer?.login ?? null, teamMembers: viewer?.teamMembers ?? [] };
  }

  getTopic(topicId: string): TopicDetail | null {
    const board = this.board();
    const topic = board.topic(topicId);
    if (!topic) {
      return null;
    }
    const isUnsorted = topicId === UNSORTED_TOPIC_ID;
    return {
      topic,
      placement: isUnsorted ? null : placementOf(this.store, topic, this.store.dossiers.latest(topicId) ?? undefined),
      tiles: this.tileViews(board, topicId),
      sets: isUnsorted ? [] : this.store.sets.listActiveForTopic(topicId),
      pendingProposals: isUnsorted ? [] : this.store.proposals.listPendingForTopic(topicId),
      dossier: isUnsorted ? null : this.memory.dossierView(topicId, board.prs),
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
    return debugNotificationRows(this.board(), threads, actions, decisions);
  }

  /** "Handled quietly": the quiet mark-reads of the last HANDLED_QUIETLY_DAYS days, newest first. */
  handledQuietly(): QuietReadView[] {
    const since = new Date(this.now().getTime() - HANDLED_QUIETLY_DAYS * 24 * 3600_000).toISOString();
    const entries = this.store.actionLog.listByOriginSince('quiet', since);
    const titles = new Map(this.store.notifications.list().map((thread) => [thread.id, thread.title]));
    return quietReadViews(this.board(), entries, titles);
  }

  /** Search bar filter over the stored PRs, in memory: a few hundred PRs at most. */
  search(query: string, scope?: ListScope): SearchResult {
    const board = this.board();
    const settings = scopedSettings(loadRepoSettings(this.store), scope);
    // Only the topics the sidebar lists, each with all its tiles, like an opened topic.
    const listed = board.topics().filter((topic) => this.isListed(board.tilesForTopic(topic.id), settings));
    const topics: SearchableTopic[] = listed.map((topic) => ({
      topicId: topic.id,
      name: topic.name,
      area: topic.area,
      tiles: board.tilesForTopic(topic.id).map((tile) => ({
        tileId: tile.id,
        prs: tile.members.flatMap((member) => {
          const pr = board.prs.get(member.prKey);
          return pr ? [{ key: pr.key, title: pr.title, author: pr.author, headRef: pr.headRef }] : [];
        }),
      })),
    }));
    return searchTopics(topics, query);
  }

  getPr(key: PrKey): PrDetail | null {
    const board = this.board();
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
    const events = (board.events.get(key) ?? []).map((event) => ({ event, display: displayState(event) }));
    const viewer = loadViewer(this.store);
    const news = whatsNew(pr, board.events.get(key) ?? [], viewer);
    const stale = this.staleGlances(board, [key]).has(key);
    const gap = this.glanceGap(key, glance !== null);
    return {
      pr,
      events,
      activity: activityList(events, viewer, news?.anchor.at ?? null, pr),
      whatsNew: news,
      glance,
      glanceStale: stale,
      glanceGap: gap,
      glanceState: this.glanceState(board, key, { hasGlance: glance !== null, stale, gap, wanted: glanceTargetKeys(board) }),
      userState: board.userStates.get(key) ?? null,
      viewerApproval: viewerApproval(pr, board.userStates.get(key) ?? null, loadViewer(this.store)?.login),
      agentApprovers: agentOnlyApprovers(standingApprovals(pr)),
      topicId: board.topicIdOf(key),
      tileIds: [...tileIds],
      facts: this.memory.prFacts(key),
    };
  }

  listFacts(query: FactQuery): FactView[] {
    return this.memory.listFacts(query);
  }
}
