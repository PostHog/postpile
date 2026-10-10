import type {
  ChatMessage,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposal,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsVersion,
  InstructionsView,
  LessonView,
} from '@postpile/core';
import { SampleClock } from './sample-builders.ts';
import { cleanPoint, nearDuplicate, withPointPlaced } from './fake-placement.ts';

/** Where a point goes when no heading is about it: what the user wants to hear about. */
const DEFAULT_HEADING = 'What I care about';

/** The general chat's tile id, as in the real engine. */
const CHAT_ID = 'instructions';

const FOUND_ON_DISK = `# About me
- I work on developer experience: CI, build tooling, local dev.
- I review CI and workflow changes for the team. I rarely review product code.

# What I care about
- CI cost and queue time.
- Cache keys and Turbo hashing.

# What to skip
- Dependency bumps, unless they touch CI config.
`;

const MERGE_REQUEST = 'From now on, tell me when something is merged without my review.';
const AFTER_CHAT = FOUND_ON_DISK.replace('- Cache keys and Turbo hashing.\n', `- Cache keys and Turbo hashing.\n- Tell me when something is merged without my review.\n`);
const AFTER_HAND_EDIT = AFTER_CHAT.replace('- CI cost and queue time.', '- CI cost and queue time, per run and per month.');

/** Where an accepted proposal came from, as in the real engine. */
type ProposalSource = { kind: 'chat'; message: ChatMessage } | { kind: 'lesson'; lesson: LessonView };

export interface FakeInstructionsDeps {
  now: () => Date;
  newId: () => number;
  /** Topics with a dossier; each refreshes once after an accepted change. */
  dossiersToRefresh: () => number;
  /** Tile chat messages live in FakeEngine; proposals from tile chat point at them. */
  findTileMessage: (id: number) => ChatMessage | undefined;
  /** Open lessons live in FakeLessons; "Use across topics" proposals point at them. */
  findLesson: (id: number) => LessonView | undefined;
  /** An accepted lesson proposal keeps the lesson for all topics: it is no longer offered. */
  lessonKept: (id: number) => void;
  /** Start with no instructions at all, like a first run (POSTPILE_FAKE_SETUP=1). */
  empty?: boolean;
}

/**
 * instructions.md for FakeEngine, kept in memory: three sample versions (found
 * on disk, one from chat, one hand edit) and a canned proposal that puts the
 * user's point, or a lesson's line, under the heading it fits and notices
 * when a line already says it (fake-placement.ts). Nothing is ever written
 * to disk.
 */
export class FakeInstructions {
  private readonly versions: InstructionsVersion[] = [];
  private readonly chat: ChatMessage[] = [];
  /** The line of each lesson saved as a version, for the history's source text after the lesson is closed. */
  private readonly lessonLines = new Map<number, string>();

  constructor(private readonly deps: FakeInstructionsDeps) {
    if (deps.empty) {
      return;
    }
    const clock = new SampleClock(deps.now());
    const request = this.addMessage('user', MERGE_REQUEST, clock.hoursAgo(200));
    this.addMessage('agent', 'Proposed: Tell me about merges without my review', clock.hoursAgo(200));
    this.versions.push(
      { version: 1, text: FOUND_ON_DISK, summary: 'Found on disk', origin: 'outside', sourceChatMessageId: null, sourceLessonId: null, createdAt: clock.hoursAgo(300) },
      {
        version: 2,
        text: AFTER_CHAT,
        summary: 'Tell me about merges without my review',
        origin: 'chat',
        sourceChatMessageId: request.id,
        sourceLessonId: null,
        createdAt: clock.hoursAgo(200),
      },
      { version: 3, text: AFTER_HAND_EDIT, summary: 'Edited outside the app', origin: 'outside', sourceChatMessageId: null, sourceLessonId: null, createdAt: clock.hoursAgo(40) },
    );
  }

  /** Null only while there are no versions (a first run). */
  private latest(): InstructionsVersion | null {
    return this.versions.at(-1) ?? null;
  }

  private addMessage(role: ChatMessage['role'], text: string, createdAt = this.deps.now().toISOString()): ChatMessage {
    const message: ChatMessage = { id: this.deps.newId(), tileId: CHAT_ID, topicId: '', role, text, createdAt };
    this.chat.push(message);
    return message;
  }

  private findMessage(id: number): ChatMessage | undefined {
    return this.chat.find((message) => message.id === id) ?? this.deps.findTileMessage(id);
  }

  /** The new text with `line` under the heading it fits, against the latest version. */
  private placed(line: string): Pick<InstructionsProposal, 'baseVersion' | 'baseText' | 'text' | 'summary' | 'dossiersToRefresh'> {
    const latest = this.latest();
    const baseText = latest?.text ?? '';
    const placed = withPointPlaced(baseText, line, DEFAULT_HEADING);
    const where = placed.heading === null ? '' : ` under ${placed.heading}`;
    return {
      baseVersion: latest?.version ?? null,
      baseText,
      text: placed.text,
      summary: `Added${where}: ${line.length > 80 ? `${line.slice(0, 79)}…` : line}`,
      dossiersToRefresh: this.deps.dossiersToRefresh(),
    };
  }

  /** The line of the latest version that already says the user's point, or null. */
  private alreadySaid(point: string): string | null {
    return nearDuplicate(this.latest()?.text ?? '', point);
  }

  /** Stand-in for the agent: the user's message becomes a line under the heading it fits. */
  private proposalFrom(message: ChatMessage): InstructionsProposal {
    return { ...this.placed(cleanPoint(message.text)), sourceChatMessageId: message.id, sourceLessonId: null };
  }

  /** Stand-in for the agent's answer to a point the instructions already hold: no proposal, and why. */
  private alreadySaidReply(message: ChatMessage): string | null {
    const line = this.alreadySaid(cleanPoint(message.text));
    return line === null ? null : `Your instructions already say this: "${line}"`;
  }

  /** Stand-in for the agent on "Use across topics": the lesson's line goes under the heading it fits. */
  proposalFromLesson(lesson: LessonView): InstructionsProposal {
    return { ...this.placed(lesson.text), sourceChatMessageId: null, sourceLessonId: lesson.id };
  }

  private sourceText(version: InstructionsVersion): string | null {
    if (version.sourceLessonId !== null) {
      return this.lessonLines.get(version.sourceLessonId) ?? null;
    }
    return version.sourceChatMessageId === null ? null : (this.findMessage(version.sourceChatMessageId)?.text ?? null);
  }

  view(): InstructionsView {
    const latest = this.latest();
    return {
      text: latest?.text ?? '',
      version: latest?.version ?? null,
      path: null,
      versions: [...this.versions].reverse().map((version) => ({ ...version, sourceText: this.sourceText(version) })),
      dossiersToRefresh: this.deps.dossiersToRefresh(),
    };
  }

  chatHistory(): ChatMessage[] {
    return [...this.chat];
  }

  chatMessage(text: string): InstructionsChatReply {
    const userMessage = this.addMessage('user', text);
    const already = this.alreadySaidReply(userMessage);
    if (already !== null) {
      return { message: this.addMessage('agent', already), proposal: null };
    }
    const proposal = this.proposalFrom(userMessage);
    return { message: this.addMessage('agent', `Proposed: ${proposal.summary}`), proposal };
  }

  propose(message: ChatMessage): InstructionsProposalReply {
    if (message.role !== 'user') {
      return { reply: 'Only your own messages can change your instructions.', proposal: null };
    }
    const already = this.alreadySaidReply(message);
    if (already !== null) {
      return { reply: already, proposal: null };
    }
    return { reply: 'Proposed.', proposal: this.proposalFrom(message) };
  }

  proposeFromId(sourceChatMessageId: number): InstructionsProposalReply {
    const message = this.findMessage(sourceChatMessageId);
    return message ? this.propose(message) : { reply: `No chat message ${sourceChatMessageId}.`, proposal: null };
  }

  /** The proposal's source, or why it cannot be saved. Like the engine: a lesson must still be open. */
  private source(proposal: InstructionsProposal): ProposalSource | string {
    if (proposal.sourceLessonId !== null) {
      const lesson = this.deps.findLesson(proposal.sourceLessonId);
      return lesson ? { kind: 'lesson', lesson } : 'This lesson was already decided or withdrawn.';
    }
    const message = proposal.sourceChatMessageId === null ? undefined : this.findMessage(proposal.sourceChatMessageId);
    if (!message || message.role !== 'user') {
      return 'A change to your instructions must come from one of your own chat messages or a lesson you chose.';
    }
    return { kind: 'chat', message };
  }

  private proposeAgain(source: ProposalSource): InstructionsProposal {
    return source.kind === 'lesson' ? this.proposalFromLesson(source.lesson) : this.proposalFrom(source.message);
  }

  /** A lesson's version also keeps the lesson for all topics, so it is no longer offered. */
  private write(text: string, summary: string, source: ProposalSource): number {
    const version = (this.latest()?.version ?? 0) + 1;
    const createdAt = this.deps.now().toISOString();
    if (source.kind === 'chat') {
      this.versions.push({ version, text, summary, origin: 'chat', sourceChatMessageId: source.message.id, sourceLessonId: null, createdAt });
      return version;
    }
    this.versions.push({ version, text, summary, origin: 'lesson', sourceChatMessageId: null, sourceLessonId: source.lesson.id, createdAt });
    this.lessonLines.set(source.lesson.id, source.lesson.text);
    this.deps.lessonKept(source.lesson.id);
    return version;
  }

  /** Same contract as the real engine; there is no disk, so only a stale base can conflict. */
  save(decision: InstructionsDecision): InstructionsSaveResult {
    const { proposal } = decision;
    const source = this.source(proposal);
    const refused = (message: string): InstructionsSaveResult => ({ ok: false, message, undoToken: null, savedVersion: null, rebased: null });
    if (typeof source === 'string') {
      return refused(source);
    }
    const text = decision.text.trim();
    if (text === '') {
      return refused('Empty instructions are not saved from here. Edit the file by hand to clear it.');
    }
    if (proposal.baseVersion !== (this.latest()?.version ?? null)) {
      const rebased = this.proposeAgain(source);
      return { ok: false, message: 'Your instructions changed since this was proposed. Here is the change again on top of them.', undoToken: null, savedVersion: null, rebased };
    }
    const summary = text === proposal.text.trim() ? proposal.summary : `${proposal.summary} (edited)`;
    const version = this.write(`${text}\n`, summary, source);
    const refresh = this.deps.dossiersToRefresh();
    const message = `Saved as version ${version}. Will refresh ${refresh} topic ${refresh === 1 ? 'dossier' : 'dossiers'} on next sync.`;
    return { ok: true, message, undoToken: null, savedVersion: version, rebased: null };
  }

  /** Setup's accept: a new version with origin setup. Returns its number. */
  saveFromSetup(text: string, summary: string): number {
    const version = (this.latest()?.version ?? 0) + 1;
    this.versions.push({ version, text, summary, origin: 'setup', sourceChatMessageId: null, sourceLessonId: null, createdAt: this.deps.now().toISOString() });
    return version;
  }
}
