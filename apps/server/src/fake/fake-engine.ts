import type {
  ActionLogEntry,
  ActionResult,
  ChatMessage,
  ChatReply,
  ConsolidationReport,
  EventDisplayState,
  EventView,
  FactQuery,
  FactView,
  Feedback,
  FeedbackInput,
  FeedbackKind,
  GitHubWritesChange,
  GitHubWritesStatus,
  GlanceGap,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  LivePollStatus,
  Loudness,
  MemoryCorrection,
  MemoryCorrectionKind,
  MemoryRecheckOutcome,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  NotificationDebugRow,
  NotificationThread,
  NotificationLanding,
  PendingProposals,
  PrDetail,
  PrEvent,
  PrKey,
  PrSummary,
  SnoozeCondition,
  SyncReport,
  Tile,
  TileState,
  TileView,
  TopicDetail,
  TopicListItem,
  UnreadReason,
  UserPrState,
  ViewerView,
} from '@code-manager/core';
import {
  compareTopicUrgency,
  actionTrail,
  broughtBackReason,
  debugEventLines,
  emptyAgentCallStats,
  fixedClaimNote,
  isMergeApprovedMove,
  memberTier,
  OFF_POLL_STATUS,
  systemTimers,
  openThreadCount,
  personRelation,
  pingedPrKeys,
  prStatus,
  prTier,
  searchTopics,
  setIdFromTileId,
  tilePeople,
  threadPrKey,
  tileTier,
  tileWhy,
  topicPeople,
  topicQueues,
  topicUrgency,
  whoseTurn,
  whyHere,
  type AgentCallStats,
  type Pr,
  type PrTier,
  type TileMember,
  type SearchableTopic,
  type SearchResult,
  type Viewer,
} from '@code-manager/core';
import { LivePoller, UNDO_WINDOW_MS, type EngineService, type LivePollOptions, type PollCycle } from '@code-manager/engine';
import { FakeInstructions } from './fake-instructions.ts';
import { FakeLivePoll } from './fake-live.ts';
import { FakeMemory } from './fake-memory.ts';
import { sampleThreads } from './fake-notifications.ts';
import { FakeWrites } from './fake-writes.ts';
import { buildSampleData, type SampleData } from './sample-data.ts';

interface MarkReadBatch {
  token: string;
  batchId: string;
  eventIds: string[];
  handledPrKeys: PrKey[];
  queuedAt: number;
}

export interface FakeEngineOptions {
  now?: () => Date;
  /** How long a canned recheck "thinks". Tests pass 0. */
  recheckDelayMs?: number;
}

const FAKE_FEEDBACK_KINDS: Record<MemoryCorrectionKind, FeedbackKind> = {
  wrong: 'memory_wrong',
  forget: 'memory_forget',
  confirm: 'memory_confirmed',
  fix: 'memory_fixed',
};

const FAKE_LINE_MESSAGES: Record<MemoryCorrectionKind, string> = {
  wrong: 'Noted. The next sync rewrites the topic memory without it.',
  forget: 'Noted. The next sync rewrites the topic memory without it.',
  confirm: 'Kept. The next sync keeps that line.',
  fix: 'Fixed. The next sync writes the corrected line into the topic memory.',
};

const RECHECK_CYCLE: MemoryRecheckOutcome[] = ['holds', 'fix', 'drop'];

function ok(message: string, undoToken: string | null = null): ActionResult {
  return { ok: true, message, undoToken };
}

function fail(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}

function loudnessOf(event: PrEvent): Loudness {
  return event.override?.loudness ?? event.ruleLoudness;
}

function displayOf(event: PrEvent): EventDisplayState {
  return event.seenAt ? 'seen' : loudnessOf(event);
}

function isUnseenLoud(event: PrEvent): boolean {
  return !event.seenAt && loudnessOf(event) === 'loud';
}

/** Stand-in for the agent spotting a lasting point in chat. Where it applies is the user's pick. */
const LASTING = /\b(always|never|from now on|in general|every topic|all topics)\b/i;

/** Canned numbers so the footer has something to show; the fake never calls the agent. */
function sampleSyncStats(): AgentCallStats {
  const stats = emptyAgentCallStats();
  const count = (calls: number, durationMs: number, costUsd: number) => ({
    calls, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs, costUsd,
  });
  stats.byKind.dossier_update = count(2, 38000, 0.12);
  stats.byKind.glance_batch = count(1, 9000, 0.01);
  stats.byKind.event_classification = count(1, 6000, 0.01);
  stats.total = 4;
  return stats;
}

/**
 * In-memory EngineService over the Depot sample data. Lets the server, CLI and
 * desktop app run before the real engine exists. Never talks to GitHub or the
 * agent; actions only change the in-memory copy. Tile state uses its own small
 * rules here, the real ones live in core.
 */
export class FakeEngine implements EngineService {
  private readonly data: SampleData;
  private readonly memory: FakeMemory;
  private readonly instructions: FakeInstructions;
  private readonly live: FakeLivePoll;
  private livePoller: LivePoller | null = null;
  private readonly now: () => Date;
  private readonly snoozes = new Map<string, SnoozeCondition>();
  private readonly chats = new Map<string, ChatMessage[]>();
  private readonly feedback: Feedback[];
  private readonly batches: MarkReadBatch[] = [];
  private readonly writes: FakeWrites;
  private readonly memoryUndos = new Map<string, { until: number; undo: () => void }>();
  private readonly recheckDelayMs: number;
  private recheckCount = 0;
  // Starts above the ids of the seeded feedback.
  private nextId = 100;


  constructor(options: FakeEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.recheckDelayMs = options.recheckDelayMs ?? 1500;
    this.data = buildSampleData(this.now());
    this.memory = new FakeMemory(this.data, this.now);
    this.feedback = [...this.memory.seedFeedback()];
    this.live = new FakeLivePoll(this.data, this.now);
    this.writes = new FakeWrites(this.now);
    this.instructions = new FakeInstructions({
      now: this.now,
      newId: () => this.newId(),
      dossiersToRefresh: () => this.memory.topicsWithDossier(),
      findTileMessage: (id) => [...this.chats.values()].flat().find((message) => message.id === id),
    });
  }

  // -------------------------------------------------------------------------
  // Lookups and derived state
  // -------------------------------------------------------------------------

  private timestamp(): string {
    return this.now().toISOString();
  }

  private newId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  /** Sample PRs without a glance read as skipped by the call cap. */
  private glanceGapOf(prKey: PrKey): GlanceGap | null {
    if (this.data.glances.some((glance) => glance.prKey === prKey)) {
      return null;
    }
    return { reason: 'call_cap', detail: 'The sync stopped at its agent-call cap before this PR.', at: this.timestamp() };
  }

  private findTile(tileId: string): Tile | undefined {
    return this.data.tiles.find((tile) => tile.id === tileId);
  }

  private eventsOf(prKey: PrKey): PrEvent[] {
    return this.data.events.filter((event) => event.prKey === prKey);
  }

  private userStateOf(prKey: PrKey): UserPrState {
    let state = this.data.userStates.find((candidate) => candidate.prKey === prKey);
    if (!state) {
      state = { prKey, approvedAt: null, approvedCommitOid: null, handledAt: null, broughtBackAt: null };
      this.data.userStates.push(state);
    }
    return state;
  }

  /** A push after the approval makes the PR not done again, like the real rule. */
  private isPrDone(prKey: PrKey): boolean {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    const state = this.data.userStates.find((candidate) => candidate.prKey === prKey);
    const approvedHead = Boolean(state?.approvedAt) && (state?.approvedCommitOid ?? pr?.headOid) === pr?.headOid;
    return Boolean(approvedHead || state?.handledAt || pr?.state !== 'OPEN');
  }

  private viewer(): Viewer {
    return { login: this.data.viewer, teams: this.data.viewerTeams, teamMembers: this.data.viewerTeamMembers };
  }

  private isSnoozed(tileId: string): boolean {
    const condition = this.snoozes.get(tileId);
    if (condition?.kind === 'until_time' && condition.until <= this.timestamp()) {
      this.snoozes.delete(tileId);
      return false;
    }
    return condition !== undefined;
  }

  private tileState(tile: Tile): TileState {
    const unreadBecause: UnreadReason[] = [];
    for (const member of tile.members) {
      const broughtBackAt = this.data.userStates.find((state) => state.prKey === member.prKey)?.broughtBackAt ?? null;
      if (broughtBackAt !== null) {
        unreadBecause.push(broughtBackReason(member.prKey, broughtBackAt, this.data.viewer));
      }
      for (const event of this.eventsOf(member.prKey).filter(isUnseenLoud)) {
        unreadBecause.push({
          prKey: member.prKey,
          eventId: event.id,
          kind: event.kind,
          actor: event.actor,
          summary: event.summary,
          at: event.at,
        });
      }
    }
    if (unreadBecause.length > 0) {
      return { kind: 'unread', unreadBecause };
    }
    if (this.isSnoozed(tile.id)) {
      return { kind: 'snoozed', unreadBecause };
    }
    const pingedMembers = tile.members.filter((member) => member.provenance.kind === 'pinged');
    if (pingedMembers.every((member) => this.isPrDone(member.prKey))) {
      return { kind: 'done', unreadBecause };
    }
    return { kind: 'open', unreadBecause };
  }

  /** Same tier rule as the engine; the sample has no threads, so a pinged member's reason stands in. */
  private tierOf(pr: Pr, member: TileMember | undefined): PrTier {
    const reason = member?.provenance.kind === 'pinged' ? member.provenance.reason : null;
    return prTier({ pr, events: this.eventsOf(pr.key), viewer: this.viewer(), reason });
  }

  /** Why-codes, status pills, faces and whose turn come from the same core rules as the engine. */
  private tileView(tile: Tile): TileView {
    const viewer = this.viewer();
    const prs: PrSummary[] = [];
    const memberPrs: Pr[] = [];
    for (const member of tile.members) {
      const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
      if (!pr) {
        continue;
      }
      memberPrs.push(pr);
      const glance = this.data.glances.find((candidate) => candidate.prKey === pr.key);
      prs.push({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        state: pr.state,
        isDraft: pr.isDraft,
        provenance: member.provenance,
        why: whyHere(member.provenance, pr, viewer),
        tier: memberTier(this.tierOf(pr, member), member.provenance),
        authorRelation: personRelation(pr.author, viewer),
        status: prStatus(pr),
        openThreads: openThreadCount(pr),
        verdict: glance?.verdict ?? null,
        glanceStale: false,
        forYou: glance?.forYou ?? null,
        glanceGap: this.glanceGapOf(pr.key),
        unseenLoudEvents: this.eventsOf(pr.key).filter(isUnseenLoud).length,
        updatedAt: pr.updatedAt,
      });
    }
    const turn = whoseTurn({
      tile,
      prs: new Map(memberPrs.map((pr) => [pr.key, pr])),
      events: new Map(memberPrs.map((pr) => [pr.key, this.eventsOf(pr.key)])),
      userStates: new Map(this.data.userStates.map((state) => [state.prKey, state])),
      viewer,
    });
    return {
      tile,
      state: this.tileState(tile),
      prs,
      why: tileWhy(prs.map((pr) => pr.why)),
      tier: tileTier(prs.map((pr) => pr.tier)),
      people: tilePeople(memberPrs, viewer.login),
      turn,
    };
  }

  private tilesOfTopic(topicId: string): Tile[] {
    return this.data.tiles.filter((tile) => tile.topicId === topicId);
  }

  /** Same landing rules as the engine's debug view, over the sample data. */
  private landingOf(key: PrKey | null): NotificationLanding {
    if (key === null) {
      return { kind: 'not_pr' };
    }
    if (!this.data.prs.some((pr) => pr.key === key)) {
      return { kind: 'pr_not_synced' };
    }
    const holds = (tile: Tile) => tile.members.some((member) => member.prKey === key);
    // Pulled-in layers have no membership and show in their anchor's topic.
    const topicId = this.data.membership.get(key) ?? this.data.tiles.find(holds)?.topicId ?? null;
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (topicId === null || !topic) {
      return { kind: 'no_topic' };
    }
    if (topic.status !== 'active') {
      return { kind: 'topic_hidden', topicId, topicName: topic.name };
    }
    // Some sample PRs keep their own topic but sit in another topic's set tile.
    const tile = this.tilesOfTopic(topicId).find(holds) ?? this.data.tiles.find(holds);
    const tileTopic = this.data.topics.find((candidate) => candidate.id === tile?.topicId);
    if (!tile || !tileTopic) {
      return { kind: 'no_tile', topicId, topicName: topic.name };
    }
    return {
      kind: 'tile',
      topicId: tileTopic.id,
      topicName: tileTopic.name,
      tileId: tile.id,
      tileTitle: tile.title,
      tileState: this.tileState(tile).kind,
      unsorted: false,
    };
  }

  private recordFeedback(input: Omit<Feedback, 'id' | 'createdAt'>): void {
    this.feedback.push({ ...input, id: this.newId(), createdAt: this.timestamp() });
  }

  // -------------------------------------------------------------------------
  // EngineService: reads
  // -------------------------------------------------------------------------

  async sync(): Promise<SyncReport> {
    const startedAt = this.timestamp();
    return {
      startedAt,
      finishedAt: this.timestamp(),
      notificationsNotModified: true,
      threads: this.data.tiles.length,
      prsFetched: 0,
      prsSkipped: 0,
      prsPulledIn: 0,
      newEvents: 0,
      agentCalls: 4,
      agentCallStats: sampleSyncStats(),
      dossiersUpdated: 2,
      facts: { added: 0, updated: 0, invalidated: 0, confirmed: 0, stale: 0 },
      errors: [],
    };
  }

  /** Each PR of the tiles once, with the tile member it came from (for the tier's reason). */
  private topicPrs(tiles: Tile[]): { pr: Pr; member: TileMember }[] {
    const found = new Map<PrKey, { pr: Pr; member: TileMember }>();
    for (const member of tiles.flatMap((tile) => tile.members)) {
      const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
      if (pr && !found.has(pr.key)) {
        found.set(pr.key, { pr, member });
      }
    }
    return [...found.values()];
  }

  /** Same urgency rule and order as the engine; ties keep the sample's order. */
  async listTopics(): Promise<TopicListItem[]> {
    const viewer = this.viewer();
    const shown = this.data.topics.filter((topic) => topic.status === 'active');
    const items = shown.map((topic): TopicListItem => {
      const tiles = this.tilesOfTopic(topic.id);
      const views = tiles.map((tile) => this.tileView(tile));
      const urgency = topicUrgency(
        views.map((view) => ({
          state: view.state.kind,
          prStates: view.prs.map((pr) => pr.state),
          yourMove: view.turn.kind === 'you',
          mergeApproved: isMergeApprovedMove(view.turn),
        })),
      );
      const prs = this.topicPrs(tiles);
      const pinged = pingedPrKeys(tiles);
      return {
        topic,
        statusLine: this.memory.statusLine(topic.id),
        placement: this.memory.placement(topic),
        group: urgency.needsYou ? 'needs_you' : 'quiet',
        unreadTiles: urgency.unreadTiles,
        urgentUnreadTiles: urgency.urgentUnreadTiles,
        openTiles: views.filter((view) => view.state.kind === 'open').length,
        totalTiles: views.length,
        yourMoveTiles: urgency.yourMoveTiles,
        queues: topicQueues(
          prs.map(({ pr, member }) => ({
            tier: this.tierOf(pr, member),
            author: personRelation(pr.author, viewer),
            state: pr.state,
            pulledIn: !pinged.has(pr.key),
          })),
        ),
        people: topicPeople(prs.map(({ pr }) => pr), viewer),
      };
    });
    return items.sort(compareTopicUrgency);
  }

  async getViewer(): Promise<ViewerView> {
    return { login: this.data.viewer, teamMembers: this.data.viewerTeamMembers };
  }

  async getTopic(topicId: string): Promise<TopicDetail | null> {
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return null;
    }
    return {
      topic,
      placement: this.memory.placement(topic),
      tiles: this.tilesOfTopic(topicId).map((tile) => this.tileView(tile)),
      sets: this.data.sets.filter((set) => set.topicId === topicId && set.status === 'active'),
      pendingProposals: this.data.proposals.filter((proposal) => proposal.topicId === topicId && proposal.status === 'pending'),
      dossier: this.memory.dossierView(topicId, this.feedback),
    };
  }

  /** Same matcher as the engine, over the sample topics the sidebar lists. */
  async search(query: string): Promise<SearchResult> {
    const topics: SearchableTopic[] = this.data.topics
      .filter((topic) => topic.status === 'active')
      .map((topic) => ({
        topicId: topic.id,
        name: topic.name,
        area: topic.area,
        tiles: this.tilesOfTopic(topic.id).map((tile) => ({
          tileId: tile.id,
          prs: tile.members.flatMap((member) => {
            const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
            return pr ? [{ key: pr.key, title: pr.title, author: pr.author, headRef: pr.headRef }] : [];
          }),
        })),
      }));
    return searchTopics(topics, query);
  }

  /** The sample threads with their GitHub unread flag as the fake queue left it. */
  private threadsOnGitHub(): NotificationThread[] {
    return sampleThreads(this.data, this.now()).map((thread) => this.writes.onGitHub(thread));
  }

  async debugNotifications(limit: number): Promise<NotificationDebugRow[]> {
    this.writes.settle();
    const actions = this.writes.index();
    return this.threadsOnGitHub()
      .slice(0, limit)
      .map((thread) => {
        const key = threadPrKey(thread);
        return {
          thread,
          prKey: key,
          landing: this.landingOf(key),
          recentEvents: key === null ? [] : debugEventLines(this.eventsOf(key)),
          ...actionTrail(actions, thread.id, key),
        };
      });
  }

  async actionLog(limit: number): Promise<ActionLogEntry[]> {
    this.writes.settle();
    return this.writes.recent(limit);
  }

  async githubWrites(): Promise<GitHubWritesStatus> {
    return this.writes.status();
  }

  async setGitHubWrites(enabled: boolean): Promise<GitHubWritesChange> {
    return this.writes.set(enabled);
  }

  async getPr(prKey: PrKey): Promise<PrDetail | null> {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    if (!pr) {
      return null;
    }
    const events: EventView[] = this.eventsOf(prKey)
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .map((event) => ({ event, display: displayOf(event) }));
    return {
      pr,
      events,
      glance: this.data.glances.find((glance) => glance.prKey === prKey) ?? null,
      glanceStale: false,
      glanceGap: this.glanceGapOf(prKey),
      userState: this.data.userStates.find((state) => state.prKey === prKey) ?? null,
      topicId: this.data.membership.get(prKey) ?? null,
      tileIds: this.data.tiles.filter((tile) => tile.members.some((member) => member.prKey === prKey)).map((tile) => tile.id),
      facts: this.memory.prFacts(prKey),
    };
  }

  async getChat(tileId: string): Promise<ChatMessage[]> {
    return this.chats.get(tileId) ?? [];
  }

  // -------------------------------------------------------------------------
  // EngineService: actions
  // -------------------------------------------------------------------------

  async approve(prKey: PrKey): Promise<ActionResult> {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    if (!pr) {
      return fail(`no PR ${prKey}`);
    }
    if (!this.writes.isEnabled()) {
      this.writes.record({ action: 'approve', origin: 'tile', outcome: 'skipped', prKey, detail: 'GitHub writes are off' });
      return fail('GitHub writes are off (lock in the footer): nothing was approved');
    }
    this.writes.record({ action: 'approve', origin: 'tile', outcome: 'github', prKey, detail: 'sample data: nothing left the process' });
    const state = this.userStateOf(prKey);
    state.approvedAt = this.timestamp();
    state.approvedCommitOid = pr.headOid;
    for (const event of this.eventsOf(prKey)) {
      event.seenAt ??= this.timestamp();
    }
    return ok(`fake: approved ${prKey} locally, nothing sent to GitHub`);
  }

  /**
   * Events seen, `handleKeys` handled, bring-backs ended; the unread sample
   * threads go through the fake queue, which logs like the real one.
   * `extraThreads` are threads without a stored PR (debug view).
   */
  private markPrsRead(
    prKeys: PrKey[],
    handleKeys: PrKey[],
    origin: 'tile' | 'debug',
    tileId: string | null,
    extraThreads: NotificationThread[] = [],
  ): ActionResult {
    // Read the GitHub flags before the events change: the fake derives a thread's first flag from them.
    const githubThreads = this.threadsOnGitHub();
    const batch: MarkReadBatch = {
      token: `undo-${this.newId()}`,
      batchId: `fake-batch-${this.newId()}`,
      eventIds: [],
      handledPrKeys: [],
      queuedAt: this.now().getTime(),
    };
    for (const prKey of prKeys) {
      for (const event of this.eventsOf(prKey).filter((candidate) => !candidate.seenAt)) {
        event.seenAt = this.timestamp();
        batch.eventIds.push(event.id);
      }
      const state = this.userStateOf(prKey);
      state.broughtBackAt = null;
      if (handleKeys.includes(prKey) && !state.handledAt) {
        state.handledAt = this.timestamp();
        batch.handledPrKeys.push(prKey);
      }
    }
    this.batches.push(batch);
    const threads = [...githubThreads.filter((thread) => prKeys.includes(threadPrKey(thread) ?? '')), ...extraThreads]
      .filter((thread) => thread.unread)
      .map((thread) => ({ id: thread.id, prKey: threadPrKey(thread) }));
    const writesOn = this.writes.isEnabled();
    this.writes.queued({ token: batch.token, batchId: batch.batchId, origin, tileId, threads, prKeys, writesOn, queuedAt: batch.queuedAt });
    const where = writesOn ? '' : ' here only (GitHub writes are off)';
    return ok(`marked ${batch.eventIds.length} events read${where}`, batch.token);
  }

  async markRead(tileId: string): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    const keys = tile.members.map((member) => member.prKey);
    const pinged = tile.members.filter((member) => member.provenance.kind === 'pinged').map((member) => member.prKey);
    return this.markPrsRead(keys, pinged, 'tile', tileId);
  }

  private tilesHolding(prKey: PrKey): Tile[] {
    return this.data.tiles.filter((tile) => tile.members.some((member) => member.prKey === prKey));
  }

  async markThreadRead(threadId: string): Promise<ActionResult> {
    const thread = this.threadsOnGitHub().find((candidate) => candidate.id === threadId);
    if (!thread) {
      return fail(`no notification thread ${threadId}`);
    }
    const key = threadPrKey(thread);
    if (key !== null && this.data.prs.some((pr) => pr.key === key)) {
      return this.markPrsRead([key], [key], 'debug', this.tilesHolding(key)[0]?.id ?? null);
    }
    return this.markPrsRead([], [], 'debug', null, [thread]);
  }

  async bringBack(prKey: PrKey): Promise<ActionResult> {
    if (!this.data.prs.some((pr) => pr.key === prKey)) {
      return fail(`${prKey} is not in the store, so it has no tile to bring back`);
    }
    const state = this.userStateOf(prKey);
    state.broughtBackAt = this.timestamp();
    state.handledAt = null;
    const tiles = this.tilesHolding(prKey);
    for (const tile of tiles) {
      this.snoozes.delete(tile.id);
    }
    const threadId = this.threadsOnGitHub().find((thread) => threadPrKey(thread) === prKey)?.id ?? null;
    this.writes.record({
      action: 'bring_back',
      origin: 'debug',
      outcome: 'local',
      prKey,
      threadId,
      tileId: tiles[0]?.id ?? null,
      detail: 'unread again in the app; GitHub unchanged (no mark-unread API)',
    });
    return ok('Brought back: the tile is unread again here. GitHub is unchanged.');
  }

  async undo(undoToken: string | null): Promise<ActionResult> {
    const memoryUndo = undoToken ? this.memoryUndos.get(undoToken) : undefined;
    if (undoToken && memoryUndo) {
      this.memoryUndos.delete(undoToken);
      if (memoryUndo.until <= this.now().getTime()) {
        return fail('undo window closed');
      }
      memoryUndo.undo();
      return ok('Undone');
    }
    const index = undoToken ? this.batches.findIndex((batch) => batch.token === undoToken) : this.batches.length - 1;
    const batch = this.batches[index];
    if (!batch) {
      return fail('nothing to undo');
    }
    this.batches.splice(index, 1);
    if (this.now().getTime() - batch.queuedAt > UNDO_WINDOW_MS) {
      return fail('undo window closed');
    }
    this.writes.undone(batch.token);
    for (const event of this.data.events.filter((candidate) => batch.eventIds.includes(candidate.id))) {
      event.seenAt = null;
    }
    for (const prKey of batch.handledPrKeys) {
      this.userStateOf(prKey).handledAt = null;
    }
    return ok('undone');
  }

  async snooze(tileId: string, condition: SnoozeCondition): Promise<ActionResult> {
    if (!this.findTile(tileId)) {
      return fail(`no tile ${tileId}`);
    }
    this.snoozes.set(tileId, condition);
    return ok(`snoozed until ${condition.kind}`);
  }

  async unsnooze(tileId: string): Promise<ActionResult> {
    this.snoozes.delete(tileId);
    return ok('unsnoozed');
  }

  async draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
    const glance = this.data.glances.find((candidate) => candidate.prKey === prKey);
    const question = intent || 'could you say a bit more about this change?';
    const context = glance ? `\n\n${glance.forYou}` : '';
    return { body: `@${person} ${question}${context}` };
  }

  async sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
    if (!this.writes.isEnabled()) {
      this.writes.record({ action: 'comment', origin: 'tile', outcome: 'skipped', prKey, detail: 'GitHub writes are off' });
      return fail('GitHub writes are off (lock in the footer): the comment was not sent');
    }
    this.writes.record({ action: 'comment', origin: 'tile', outcome: 'github', prKey, detail: 'sample data: nothing left the process' });
    const at = this.timestamp();
    const sourceId = `local-${this.newId()}`;
    this.data.events.push({
      id: `${prKey}:comment:${sourceId}`,
      prKey,
      kind: 'comment',
      actor: this.data.viewer,
      isBot: false,
      at,
      summary: `${this.data.viewer} commented: ${body.split('\n')[0] ?? ''}`,
      url: null,
      sourceId,
      ruleLoudness: 'quiet',
      ruleReason: 'own comment',
      override: null,
      seenAt: at,
    });
    return ok('fake: comment kept locally, nothing sent to GitHub');
  }

  async giveFeedback(input: FeedbackInput): Promise<ActionResult> {
    const tile = this.findTile(input.tileId);
    if (!tile) {
      return fail(`no tile ${input.tileId}`);
    }
    this.recordFeedback({
      kind: input.kind,
      topicId: tile.topicId,
      tileId: tile.id,
      prKey: input.prKey,
      setId: setIdFromTileId(tile.id),
      eventId: null,
      note: input.note,
    });
    if (input.kind === 'not_related' && input.prKey) {
      tile.members = tile.members.filter((member) => member.prKey !== input.prKey);
      return ok(`dropped ${input.prKey} from the set`);
    }
    if (input.kind === 'wrong_topic' && input.targetTopicId) {
      tile.topicId = input.targetTopicId;
      return ok(`moved to ${input.targetTopicId}`);
    }
    if (input.kind === 'not_mine') {
      // Like the engine: a mark-read of the PR (or the whole tile) with undo.
      const keys = input.prKey ? [input.prKey] : tile.members.map((member) => member.prKey);
      const result = this.markPrsRead(keys, keys, 'tile', tile.id);
      return ok(`Noted: not yours, ${result.message}`, result.undoToken);
    }
    return ok('feedback noted');
  }

  async unmuteEvent(eventId: string): Promise<ActionResult> {
    const event = this.data.events.find((candidate) => candidate.id === eventId);
    if (!event) {
      return fail(`no event ${eventId}`);
    }
    const loudness = event.ruleLoudness === 'muted' ? 'quiet' : event.ruleLoudness;
    event.override = { loudness, reason: 'unmuted by the user', by: 'user' };
    const topicId = this.data.membership.get(event.prKey) ?? null;
    this.recordFeedback({ kind: 'unmute', topicId, tileId: null, prKey: event.prKey, setId: null, eventId, note: '' });
    return ok('unmuted');
  }

  async chat(tileId: string, message: string): Promise<ChatReply> {
    const tile = this.findTile(tileId);
    if (!tile) {
      throw new Error(`no tile ${tileId}`);
    }
    const messages = this.chats.get(tileId) ?? [];
    this.chats.set(tileId, messages);
    const userMessage: ChatMessage = { id: this.newId(), tileId, topicId: tile.topicId, role: 'user', text: message, createdAt: this.timestamp() };
    const reply: ChatMessage = {
      id: this.newId(),
      tileId,
      topicId: tile.topicId,
      role: 'agent',
      text: 'Noted. (The fake engine does not think; this is a canned reply.)',
      createdAt: this.timestamp(),
    };
    messages.push(userMessage, reply);
    if (!LASTING.test(message)) {
      return { message: reply, lastingPoint: null };
    }
    return { message: reply, lastingPoint: { topicId: tile.topicId, text: message, sourceChatMessageId: userMessage.id } };
  }

  async decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return fail(`no topic ${topicId}`);
    }
    this.recordFeedback({ kind: keep ? 'tailoring_kept' : 'tailoring_once', topicId, tileId: null, prKey: null, setId: null, eventId: null, note: text });
    if (!keep) {
      return ok('used just this once');
    }
    topic.tailoring = topic.tailoring ? `${topic.tailoring}\n${text}` : text;
    topic.updatedAt = this.timestamp();
    return ok('kept as topic tailoring');
  }

  async decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    const proposal = this.data.proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return fail(`no pending proposal ${proposalId}`);
    }
    proposal.status = accept ? 'accepted' : 'rejected';
    proposal.decidedAt = this.timestamp();
    const topic = this.data.topics.find((candidate) => candidate.id === proposal.topicId);
    if (accept && proposal.kind === 'rename' && topic && proposal.name) {
      topic.name = proposal.name;
    }
    if (accept && proposal.kind === 'merge' && topic && proposal.intoTopicId) {
      this.mergeTopic(topic.id, proposal.intoTopicId);
    }
    if (accept && proposal.kind === 'area_merge' && proposal.fromArea && proposal.name) {
      for (const moved of this.data.topics.filter((candidate) => candidate.area === proposal.fromArea)) {
        moved.area = proposal.name;
      }
    }
    return ok(accept ? 'accepted' : 'rejected');
  }

  /** Moves tiles and members over and archives the source topic. */
  private mergeTopic(fromTopicId: string, intoTopicId: string): void {
    for (const tile of this.tilesOfTopic(fromTopicId)) {
      tile.topicId = intoTopicId;
    }
    for (const [prKey, topicId] of this.data.membership) {
      if (topicId === fromTopicId) {
        this.data.membership.set(prKey, intoTopicId);
      }
    }
    const topic = this.data.topics.find((candidate) => candidate.id === fromTopicId);
    if (topic) {
      topic.status = 'archived';
      topic.updatedAt = this.timestamp();
    }
  }

  // Engine memory v2, backed by FakeMemory.

  async listFacts(query: FactQuery): Promise<FactView[]> {
    return this.memory.listFacts(query);
  }

  async listProposals(): Promise<PendingProposals> {
    const topics = this.data.proposals.filter((proposal) => proposal.status === 'pending');
    return { topics, rules: this.memory.pendingRuleProposals() };
  }

  async decideRuleProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    return this.memory.decideRuleProposal(proposalId, accept, this.data.topics);
  }

  async markTopicSeen(topicId: string): Promise<ActionResult> {
    if (!this.data.topics.some((topic) => topic.id === topicId)) {
      return fail(`no topic ${topicId}`);
    }
    this.memory.markTopicSeen(topicId);
    return ok('Marked seen');
  }

  private memoryUndo(undo: () => void): string {
    const token = `memory:${this.newId()}`;
    this.memoryUndos.set(token, { until: this.now().getTime() + UNDO_WINDOW_MS, undo });
    return token;
  }

  /** Feedback for a correction, and an undo that takes it back out. */
  private logCorrection(kind: FeedbackKind, topicId: string | null, prKey: PrKey | null, note: string): Feedback {
    this.recordFeedback({ kind, topicId, tileId: null, prKey, setId: null, eventId: null, note });
    return this.feedback[this.feedback.length - 1]!;
  }

  private dropFeedback(entry: Feedback): void {
    this.feedback.splice(this.feedback.indexOf(entry), 1);
  }

  /** Same contract as the real engine: a fact changes now, a dossier line waits for the next update. Undoable. */
  async correctMemory(input: MemoryCorrection): Promise<ActionResult> {
    const kind = FAKE_FEEDBACK_KINDS[input.kind];
    const fixed = input.fixedText?.trim() ?? '';
    if (input.kind === 'fix' && fixed === '') {
      return fail('a fix needs the corrected line');
    }
    if (input.factId === null) {
      if (!this.data.topics.some((topic) => topic.id === input.topicId)) {
        return fail(`no topic ${input.topicId ?? ''}`);
      }
      if (input.relation && input.topicId) {
        this.memory.overrideRelation(input.topicId, input.relation);
      }
      let note = input.relation ? `${input.text} (it is actually: ${input.relation})` : input.text;
      if (input.kind === 'fix') {
        note = fixedClaimNote({ text: input.text, fixed });
      }
      const entry = this.logCorrection(kind, input.topicId, null, note);
      const token = this.memoryUndo(() => this.dropFeedback(entry));
      return ok(input.relation ? 'Moved. It stays there until something new happens in the topic.' : FAKE_LINE_MESSAGES[input.kind], token);
    }
    const fact = this.memory.findFact(input.factId);
    if (!fact || fact.invalidAt !== null) {
      return fail(`no fact ${input.factId}`);
    }
    const before = { ...fact };
    const prKey = fact.refs[0]?.prKey ?? null;
    if (input.kind === 'confirm') {
      fact.staleAt = null;
      fact.staleReason = null;
      fact.verifiedAt = this.timestamp();
      const entry = this.logCorrection(kind, fact.topicId, prKey, fact.text);
      return ok('Kept that fact', this.memoryUndo(() => {
        Object.assign(fact, before);
        this.dropFeedback(entry);
      }));
    }
    if (input.kind === 'fix') {
      const replacement = this.memory.replaceFact(fact, fixed, `f-fix-${this.newId()}`);
      const entry = this.logCorrection(kind, fact.topicId, prKey, fixedClaimNote({ text: fact.text, fixed }));
      return ok('Replaced that fact with the corrected one', this.memoryUndo(() => {
        Object.assign(fact, before);
        this.memory.closeFact(replacement.id, 'the user undid the fix');
        this.dropFeedback(entry);
      }));
    }
    this.memory.closeFact(fact.id, 'the user said it is wrong');
    const entry = this.logCorrection(kind, fact.topicId, prKey, fact.text);
    return ok('Forgot that fact', this.memoryUndo(() => {
      Object.assign(fact, before);
      this.dropFeedback(entry);
    }));
  }

  /**
   * Canned answers after a short wait, cycling holds / fix / drop so every
   * dialog state can be seen. No agent, no cap.
   */
  async recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult> {
    await new Promise((resolve) => setTimeout(resolve, this.recheckDelayMs));
    const outcome = RECHECK_CYCLE[this.recheckCount % RECHECK_CYCLE.length] ?? 'holds';
    this.recheckCount += 1;
    if (outcome === 'fix') {
      return { status: 'answered', outcome, text: `${request.text.replace(/\.$/, '')} (sample correction).`, why: 'Sample answer: a newer comment on the PR says otherwise.' };
    }
    const why = outcome === 'holds' ? 'Sample answer: the newest review and comments still say the same.' : 'Sample answer: the PR this came from was closed and nobody picked it up.';
    return { status: 'answered', outcome, text: request.text, why };
  }

  async getMemorySources(target: MemoryTarget): Promise<MemorySources | null> {
    return this.memory.sources(target);
  }

  async getInstructions(): Promise<InstructionsView> {
    return this.instructions.view();
  }

  async getInstructionsChat(): Promise<ChatMessage[]> {
    return this.instructions.chatHistory();
  }

  async instructionsChat(message: string): Promise<InstructionsChatReply> {
    return this.instructions.chatMessage(message);
  }

  async proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposalReply> {
    return this.instructions.proposeFromId(sourceChatMessageId);
  }

  async saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    return this.instructions.save(decision);
  }

  async consolidate(): Promise<ConsolidationReport> {
    return this.memory.consolidate();
  }

  // -------------------------------------------------------------------------
  // EngineService: live poll (a new sample question every ~45s)
  // -------------------------------------------------------------------------

  async pollOnce(): Promise<PollCycle> {
    return this.live.poll();
  }

  /** The real scheduler and burst grouping over the fake poll. */
  startLivePoll(options: LivePollOptions): void {
    if (this.livePoller) {
      return;
    }
    this.livePoller = new LivePoller(() => this.pollOnce(), systemTimers, options);
    this.livePoller.start();
  }

  stopLivePoll(): void {
    this.livePoller?.stop();
    this.livePoller = null;
  }

  async livePollStatus(): Promise<LivePollStatus> {
    return this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
  }

  async flushPendingWrites(): Promise<void> {
    // Nothing leaves the process; the fake queue only logs and flips sample flags.
    this.writes.flush();
    this.batches.length = 0;
  }

  async close(): Promise<void> {
    this.stopLivePoll();
  }
}
