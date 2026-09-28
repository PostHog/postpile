import {
  compareTopicUrgency,
  displayState,
  isMergeApprovedMove,
  isPrInQuietRepo,
  isQuietTile,
  isTopicInScope,
  isUnseenLoud,
  labelBaseRepo,
  memberTier,
  openThreadCount,
  personRelation,
  pingedPrKeys,
  prStatus,
  prTier,
  repoOverview,
  searchTopics,
  tileRepoLabels,
  TILE_STATE_ORDER,
  tilePeople,
  tileTier,
  tileWhy,
  topicFaces,
  topicPeople,
  topicQueues,
  topicUrgency,
  viewerOrgs,
  whoseTurn,
  whyHere,
  type FactQuery,
  type FactView,
  type GlanceGap,
  type NotificationDebugRow,
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
import { debugNotificationRows } from './debug-notifications.ts';
import { glanceGapKey } from './digest/glance-batches.ts';
import { GlanceInputs } from './glance-inputs.ts';
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

/** Builds the API read models. Every call loads a fresh Board, so state is always derived. */
export class ReadModels {
  private readonly memory: MemoryReads;

  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
    private readonly pendingWrites: PendingWrites,
  ) {
    this.memory = new MemoryReads(store, now);
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
    return prTier({ pr, events: board.events.get(pr.key) ?? [], viewer, reason });
  }

  private prSummaries(
    board: Board,
    tile: Tile,
    stale: Set<PrKey>,
    viewer: Viewer | null,
    settings: RepoSettings,
    repoLabels: (string | null)[],
  ): PrSummary[] {
    const glances = this.store.glances.getMany(tile.members.map((m) => m.prKey));
    const summaries: PrSummary[] = [];
    for (const [index, member] of tile.members.entries()) {
      const pr = board.prs.get(member.prKey);
      if (!pr) {
        continue;
      }
      const glance = glances.get(pr.key);
      const quietRepo = isPrInQuietRepo(pr.key, settings);
      summaries.push({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        state: pr.state,
        isDraft: pr.isDraft,
        provenance: member.provenance,
        why: whyHere(member.provenance, pr, viewer),
        tier: memberTier(this.tierOf(board, pr, viewer), member.provenance, quietRepo),
        authorRelation: personRelation(pr.author, viewer),
        status: prStatus(pr),
        openThreads: openThreadCount(pr),
        verdict: glance?.verdict ?? null,
        glanceStale: stale.has(pr.key),
        forYou: glance?.forYou ?? null,
        glanceGap: this.glanceGap(pr.key, glance !== undefined),
        // A found PR never counts as unread; its events are there for whose turn and memory.
        unseenLoudEvents: member.provenance.kind === 'found' ? 0 : (board.events.get(pr.key) ?? []).filter(isUnseenLoud).length,
        updatedAt: pr.updatedAt,
        quietRepo,
        repoLabel: repoLabels[index] ?? null,
      });
    }
    return summaries;
  }

  private tileViews(board: Board, topicId: string): TileView[] {
    const settings = loadRepoSettings(this.store);
    // An opened topic shows every tile; the repo scope only labels the ones from another repo.
    const tiles = board.tilesForTopic(topicId);
    const stale = this.staleGlances(board, tiles.flatMap((tile) => tile.members.map((m) => m.prKey)));
    const viewer = loadViewer(this.store);
    const pending = this.pendingWrites.byPrKey();
    const baseRepo = labelBaseRepo(tiles.flatMap(memberKeys), settings);
    const orgs = viewerOrgs(viewer?.teams ?? []);
    const views = tiles.map((tile): TileView => {
      const labels = tileRepoLabels(memberKeys(tile), baseRepo, orgs);
      const prs = this.prSummaries(board, tile, stale, viewer, settings, labels.prs);
      const memberPrs = tile.members.flatMap((member) => board.prs.get(member.prKey) ?? []);
      return {
        tile,
        state: board.stateOf(tile),
        prs,
        why: tileWhy(prs.map((pr) => pr.why)),
        tier: tileTier(prs.map((pr) => pr.tier)),
        people: tilePeople(memberPrs, viewer?.login ?? null),
        turn: whoseTurn({ tile, prs: board.prs, events: board.events, userStates: board.userStates, viewer }),
        pendingWrite: tile.members.map((member) => pending.get(member.prKey)).find((mark) => mark !== undefined) ?? null,
        quietRepo: isQuietTile(memberKeys(tile), settings),
        repoLabel: labels.tile,
      };
    });
    return views.sort((a, b) => TILE_STATE_ORDER[a.state.kind] - TILE_STATE_ORDER[b.state.kind]);
  }

  /** Each PR of the topic's tiles once, in tile order. A PR can sit in a set tile and a stack tile. */
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

  listTopics(): TopicListItem[] {
    const board = this.board();
    const topics = board.topics();
    const dossiers = this.store.dossiers.latestMany(topics.map((topic) => topic.id));
    const viewer = loadViewer(this.store);
    const settings = loadRepoSettings(this.store);
    const items: TopicListItem[] = [];
    for (const topic of topics) {
      const tiles = board.tilesForTopic(topic.id);
      if (!this.isListed(tiles, settings)) {
        continue;
      }
      const states = tiles.map((tile) => board.stateOf(tile).kind);
      const urgency = topicUrgency(
        tiles.map((tile, index) => {
          const turn = whoseTurn({ tile, prs: board.prs, events: board.events, userStates: board.userStates, viewer });
          const loudMembers = tile.members.filter((member) => !isPrInQuietRepo(member.prKey, settings));
          return {
            state: states[index] ?? 'open',
            prStates: loudMembers.flatMap((member) => board.prs.get(member.prKey)?.state ?? []),
            yourMove: turn.kind === 'you',
            mergeApproved: isMergeApprovedMove(turn),
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
        yourMoveTiles: urgency.yourMoveTiles,
        queues: topicQueues(
          prs.map((pr) => ({
            tier: this.tierOf(board, pr, viewer),
            author: personRelation(pr.author, viewer),
            state: pr.state,
            pulledIn: !pinged.has(pr.key),
            quiet: isPrInQuietRepo(pr.key, settings),
          })),
        ),
        people: topicFaces(topicPeople(prs, viewer)),
      });
    }
    return items.sort(compareTopics);
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
    return debugNotificationRows(this.board(), this.store.notifications.list().slice(0, limit), actions);
  }

  /** Search bar filter over the stored PRs, in memory: a few hundred PRs at most. */
  search(query: string): SearchResult {
    const board = this.board();
    const settings = loadRepoSettings(this.store);
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
    return {
      pr,
      events: (board.events.get(key) ?? []).map((event) => ({ event, display: displayState(event) })),
      glance,
      glanceStale: this.staleGlances(board, [key]).has(key),
      glanceGap: this.glanceGap(key, glance !== null),
      userState: board.userStates.get(key) ?? null,
      topicId: board.topicIdOf(key),
      tileIds: [...tileIds],
      facts: this.memory.prFacts(key),
    };
  }

  listFacts(query: FactQuery): FactView[] {
    return this.memory.listFacts(query);
  }
}
