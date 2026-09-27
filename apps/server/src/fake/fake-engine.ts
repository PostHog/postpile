import type {
  ActionResult,
  ChatMessage,
  ChatReply,
  EventDisplayState,
  EventView,
  Feedback,
  FeedbackInput,
  Loudness,
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
import { UNDO_WINDOW_MS, type EngineService } from '@code-manager/engine';
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

/**
 * In-memory EngineService over the Depot sample data. Lets the server, CLI and
 * desktop app run before the real engine exists. Never talks to GitHub or the
 * agent; actions only change the in-memory copy. Tile state uses its own small
 * rules here, the real ones live in core.
 */
export class FakeEngine implements EngineService {
  private readonly data: SampleData;
  private readonly now: () => Date;
  private readonly snoozes = new Map<string, SnoozeCondition>();
  private readonly chats = new Map<string, ChatMessage[]>();
  private readonly feedback: Feedback[] = [];
  private readonly batches: MarkReadBatch[] = [];
  private nextId = 1;

  constructor(options: FakeEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.data = buildSampleData(this.now());
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
        unreadBecause.push({ prKey: member.prKey, eventId: event.id, kind: event.kind, summary: event.summary });
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
        unseenLoudEvents: this.eventsOf(pr.key).filter(isUnseenLoud).length,
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
      newEvents: 0,
      agentCalls: 0,
      errors: [],
    };
  }

  async listTopics(): Promise<TopicListItem[]> {
    return this.data.topics.map((topic) => {
      const states = this.tilesOfTopic(topic.id).map((tile) => this.tileState(tile));
      const unreadTiles = states.filter((state) => state.kind === 'unread').length;
      return {
        topic,
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
      tiles: this.tilesOfTopic(topicId).map((tile) => this.tileView(tile)),
      sets: this.data.sets.filter((set) => set.topicId === topicId && set.status === 'active'),
      pendingProposals: this.data.proposals.filter((proposal) => proposal.topicId === topicId && proposal.status === 'pending'),
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
      userState: this.data.userStates.find((state) => state.prKey === prKey) ?? null,
      topicId: this.data.membership.get(prKey) ?? null,
      tileIds: this.data.tiles.filter((tile) => tile.members.some((member) => member.prKey === prKey)).map((tile) => tile.id),
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
      setId: tile.kind === 'set' ? tile.id.slice('set:'.length) : null,
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
    // Stand-in for the agent spotting a lasting instruction.
    const lasting = /\b(always|never|from now on)\b/i.test(message);
    return { message: reply, tailoringProposal: lasting ? { topicId: tile.topicId, text: message } : null };
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
    return ok(accept ? 'accepted' : 'rejected');
  }

  async flushPendingWrites(): Promise<void> {
    // Nothing to send: the fake never talks to GitHub.
    this.batches.length = 0;
  }

  async close(): Promise<void> {}
}
