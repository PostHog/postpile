import type {
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
  GlanceGap,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  Loudness,
  MemoryCorrection,
  MemorySources,
  MemoryTarget,
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
} from '@code-manager/core';
import { emptyAgentCallStats, setIdFromTileId, type AgentCallStats } from '@code-manager/core';
import { UNDO_WINDOW_MS, type EngineService } from '@code-manager/engine';
import { FakeInstructions } from './fake-instructions.ts';
import { FakeMemory } from './fake-memory.ts';
import { buildSampleData, type SampleData } from './sample-data.ts';

interface MarkReadBatch {
  token: string;
  eventIds: string[];
  handledPrKeys: PrKey[];
  queuedAt: number;
}

export interface FakeEngineOptions {
  now?: () => Date;
}

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
  private readonly now: () => Date;
  private readonly snoozes = new Map<string, SnoozeCondition>();
  private readonly chats = new Map<string, ChatMessage[]>();
  private readonly feedback: Feedback[];
  private readonly batches: MarkReadBatch[] = [];
  // Starts above the ids of the seeded feedback.
  private nextId = 100;


  constructor(options: FakeEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.data = buildSampleData(this.now());
    this.memory = new FakeMemory(this.data, this.now);
    this.feedback = [...this.memory.seedFeedback()];
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
      state = { prKey, approvedAt: null, approvedCommitOid: null, handledAt: null };
      this.data.userStates.push(state);
    }
    return state;
  }

  private isPrDone(prKey: PrKey): boolean {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    const state = this.data.userStates.find((candidate) => candidate.prKey === prKey);
    return Boolean(state?.approvedAt || state?.handledAt || pr?.state !== 'OPEN');
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
      for (const event of this.eventsOf(member.prKey).filter(isUnseenLoud)) {
        unreadBecause.push({ prKey: member.prKey, eventId: event.id, kind: event.kind, summary: event.summary, at: event.at });
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

  private tileView(tile: Tile): TileView {
    const prs: PrSummary[] = [];
    for (const member of tile.members) {
      const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
      if (!pr) {
        continue;
      }
      const glance = this.data.glances.find((candidate) => candidate.prKey === pr.key);
      prs.push({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        state: pr.state,
        isDraft: pr.isDraft,
        provenance: member.provenance,
        verdict: glance?.verdict ?? null,
        glanceStale: false,
        forYou: glance?.forYou ?? null,
        glanceGap: this.glanceGapOf(pr.key),
        unseenLoudEvents: this.eventsOf(pr.key).filter(isUnseenLoud).length,
        updatedAt: pr.updatedAt,
      });
    }
    return { tile, state: this.tileState(tile), prs };
  }

  private tilesOfTopic(topicId: string): Tile[] {
    return this.data.tiles.filter((tile) => tile.topicId === topicId);
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

  async listTopics(): Promise<TopicListItem[]> {
    const shown = this.data.topics.filter((topic) => topic.status === 'active');
    return shown.map((topic) => {
      const states = this.tilesOfTopic(topic.id).map((tile) => this.tileState(tile));
      const unreadTiles = states.filter((state) => state.kind === 'unread').length;
      return {
        topic,
        statusLine: this.memory.statusLine(topic.id),
        placement: this.memory.placement(topic),
        group: unreadTiles > 0 ? 'needs_you' : 'quiet',
        unreadTiles,
        openTiles: states.filter((state) => state.kind === 'open').length,
        totalTiles: states.length,
      };
    });
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
    const state = this.userStateOf(prKey);
    state.approvedAt = this.timestamp();
    state.approvedCommitOid = pr.headOid;
    for (const event of this.eventsOf(prKey)) {
      event.seenAt ??= this.timestamp();
    }
    return ok(`fake: approved ${prKey} locally, nothing sent to GitHub`);
  }

  async markRead(tileId: string): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    const batch: MarkReadBatch = { token: `undo-${this.newId()}`, eventIds: [], handledPrKeys: [], queuedAt: this.now().getTime() };
    for (const member of tile.members) {
      for (const event of this.eventsOf(member.prKey).filter((candidate) => !candidate.seenAt)) {
        event.seenAt = this.timestamp();
        batch.eventIds.push(event.id);
      }
      const state = this.userStateOf(member.prKey);
      if (member.provenance.kind === 'pinged' && !state.handledAt) {
        state.handledAt = this.timestamp();
        batch.handledPrKeys.push(member.prKey);
      }
    }
    this.batches.push(batch);
    return ok(`marked ${batch.eventIds.length} events read`, batch.token);
  }

  async undo(undoToken: string | null): Promise<ActionResult> {
    const index = undoToken ? this.batches.findIndex((batch) => batch.token === undoToken) : this.batches.length - 1;
    const batch = this.batches[index];
    if (!batch) {
      return fail('nothing to undo');
    }
    this.batches.splice(index, 1);
    if (this.now().getTime() - batch.queuedAt > UNDO_WINDOW_MS) {
      return fail('undo window closed');
    }
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
      for (const member of tile.members) {
        this.userStateOf(member.prKey).handledAt ??= this.timestamp();
      }
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

  /** Same contract as the real engine: a fact closes now, a dossier line waits for the next update. */
  async correctMemory(input: MemoryCorrection): Promise<ActionResult> {
    const kind: FeedbackKind = input.kind === 'forget' ? 'memory_forget' : 'memory_wrong';
    if (input.factId === null) {
      if (!this.data.topics.some((topic) => topic.id === input.topicId)) {
        return fail(`no topic ${input.topicId ?? ''}`);
      }
      if (input.relation && input.topicId) {
        this.memory.overrideRelation(input.topicId, input.relation);
      }
      const note = input.relation ? `${input.text} (it is actually: ${input.relation})` : input.text;
      this.recordFeedback({ kind, topicId: input.topicId, tileId: null, prKey: null, setId: null, eventId: null, note });
      return ok(input.relation ? 'Moved. It stays there until something new happens in the topic.' : 'Noted. The next sync rewrites the topic memory without it.');
    }
    const fact = this.memory.closeFact(input.factId, 'the user said it is wrong');
    if (!fact) {
      return fail(`no fact ${input.factId}`);
    }
    const prKey = fact.refs[0]?.prKey ?? null;
    this.recordFeedback({ kind, topicId: fact.topicId, tileId: null, prKey, setId: null, eventId: null, note: fact.text });
    return ok('Forgot that fact');
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

  async flushPendingWrites(): Promise<void> {
    // Nothing to send: the fake never talks to GitHub.
    this.batches.length = 0;
  }

  async close(): Promise<void> {}
}
