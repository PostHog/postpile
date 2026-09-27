import type {
  ChatMessage,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposal,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsVersion,
  InstructionsView,
} from '@code-manager/core';
import { SampleClock } from './sample-builders.ts';

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

export interface FakeInstructionsDeps {
  now: () => Date;
  newId: () => number;
  /** Topics with a dossier; each refreshes once after an accepted change. */
  dossiersToRefresh: () => number;
  /** Tile chat messages live in FakeEngine; proposals from tile chat point at them. */
  findTileMessage: (id: number) => ChatMessage | undefined;
}

/**
 * instructions.md for FakeEngine, kept in memory: three sample versions (found
 * on disk, one from chat, one hand edit) and a canned proposal that appends
 * the user's point as a new line. Nothing is ever written to disk.
 */
export class FakeInstructions {
  private readonly versions: InstructionsVersion[] = [];
  private readonly chat: ChatMessage[] = [];

  constructor(private readonly deps: FakeInstructionsDeps) {
    const clock = new SampleClock(deps.now());
    const request = this.addMessage('user', MERGE_REQUEST, clock.hoursAgo(200));
    this.addMessage('agent', 'Proposed: Tell me about merges without my review', clock.hoursAgo(200));
    this.versions.push(
      { version: 1, text: FOUND_ON_DISK, summary: 'Found on disk', origin: 'outside', sourceChatMessageId: null, createdAt: clock.hoursAgo(300) },
      { version: 2, text: AFTER_CHAT, summary: 'Tell me about merges without my review', origin: 'chat', sourceChatMessageId: request.id, createdAt: clock.hoursAgo(200) },
      { version: 3, text: AFTER_HAND_EDIT, summary: 'Edited outside the app', origin: 'outside', sourceChatMessageId: null, createdAt: clock.hoursAgo(40) },
    );
  }

  private latest(): InstructionsVersion {
    return this.versions.at(-1)!;
  }

  private addMessage(role: ChatMessage['role'], text: string, createdAt = this.deps.now().toISOString()): ChatMessage {
    const message: ChatMessage = { id: this.deps.newId(), tileId: CHAT_ID, topicId: '', role, text, createdAt };
    this.chat.push(message);
    return message;
  }

  private findMessage(id: number): ChatMessage | undefined {
    return this.chat.find((message) => message.id === id) ?? this.deps.findTileMessage(id);
  }

  /** Stand-in for the agent: the user's message becomes a new last line. */
  private proposalFrom(message: ChatMessage): InstructionsProposal {
    const latest = this.latest();
    const line = message.text.trim().replace(/^[-*]\s*/, '');
    return {
      baseVersion: latest.version,
      baseText: latest.text,
      text: `${latest.text.trimEnd()}\n- ${line}\n`,
      summary: `Added: ${line.length > 80 ? `${line.slice(0, 79)}…` : line}`,
      sourceChatMessageId: message.id,
      dossiersToRefresh: this.deps.dossiersToRefresh(),
    };
  }

  view(): InstructionsView {
    const latest = this.latest();
    return {
      text: latest.text,
      version: latest.version,
      path: null,
      versions: [...this.versions].reverse().map((version) => ({
        ...version,
        sourceText: version.sourceChatMessageId === null ? null : (this.findMessage(version.sourceChatMessageId)?.text ?? null),
      })),
      dossiersToRefresh: this.deps.dossiersToRefresh(),
    };
  }

  chatHistory(): ChatMessage[] {
    return [...this.chat];
  }

  chatMessage(text: string): InstructionsChatReply {
    const userMessage = this.addMessage('user', text);
    const proposal = this.proposalFrom(userMessage);
    return { message: this.addMessage('agent', `Proposed: ${proposal.summary}`), proposal };
  }

  propose(message: ChatMessage): InstructionsProposalReply {
    if (message.role !== 'user') {
      return { reply: 'Only your own messages can change your instructions.', proposal: null };
    }
    return { reply: 'Proposed.', proposal: this.proposalFrom(message) };
  }

  proposeFromId(sourceChatMessageId: number): InstructionsProposalReply {
    const message = this.findMessage(sourceChatMessageId);
    return message ? this.propose(message) : { reply: `No chat message ${sourceChatMessageId}.`, proposal: null };
  }

  /** Same contract as the real engine; there is no disk, so only a stale base can conflict. */
  save(decision: InstructionsDecision): InstructionsSaveResult {
    const { proposal } = decision;
    const source = this.findMessage(proposal.sourceChatMessageId);
    const refused = (message: string): InstructionsSaveResult => ({ ok: false, message, undoToken: null, savedVersion: null, rebased: null });
    if (!source || source.role !== 'user') {
      return refused('A change to your instructions must come from one of your own chat messages.');
    }
    const text = decision.text.trim();
    if (text === '') {
      return refused('Empty instructions are not saved from here. Edit the file by hand to clear it.');
    }
    if (proposal.baseVersion !== this.latest().version) {
      const rebased = this.proposalFrom(source);
      return { ok: false, message: 'Your instructions changed since this was proposed. Here is the change again on top of them.', undoToken: null, savedVersion: null, rebased };
    }
    const version = this.latest().version + 1;
    const summary = text === proposal.text.trim() ? proposal.summary : `${proposal.summary} (edited)`;
    this.versions.push({ version, text: `${text}\n`, summary, origin: 'chat', sourceChatMessageId: source.id, createdAt: this.deps.now().toISOString() });
    const refresh = this.deps.dossiersToRefresh();
    const message = `Saved as version ${version}. Will refresh ${refresh} topic ${refresh === 1 ? 'dossier' : 'dossiers'} on next sync.`;
    return { ok: true, message, undoToken: null, savedVersion: version, rebased: null };
  }
}
