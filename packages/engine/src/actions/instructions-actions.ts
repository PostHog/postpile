import { INSTRUCTIONS_MAX_CHARS } from '@postpile/agent';
import type {
  ChatMessage,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsProposal,
  InstructionsSaveResult,
  InstructionsVersion,
  InstructionsView,
  Lesson,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { InstructionsHistory } from '../instructions/history.ts';
import type { InstructionsProposer } from '../instructions/proposer.ts';
import { checkOpenLesson, lessonEvidence } from '../lessons/lesson-check.ts';

/** chat_message tile id of the general chat in "Your instructions". It has no topic. */
export const INSTRUCTIONS_CHAT_ID = 'instructions';
const VERSIONS_SHOWN = 50;

function saveFailed(message: string): InstructionsSaveResult {
  return { ok: false, message, undoToken: null, savedVersion: null, rebased: null };
}

/** Where an accepted proposal came from: one of the user's chat messages, or a lesson they chose to use across topics. */
type ProposalSource = { kind: 'chat'; message: ChatMessage } | { kind: 'lesson'; lesson: Lesson };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The user's general instructions: the view with its version history, the
 * general chat that proposes changes, and saving an accepted proposal.
 * Writes are local (instructions.md and SQLite), never GitHub.
 */
export class InstructionsActions {
  constructor(
    private readonly store: Store,
    private readonly history: InstructionsHistory,
    private readonly proposer: InstructionsProposer,
    private readonly now: () => Date,
  ) {}

  view(): InstructionsView {
    const current = this.history.current();
    const versions = this.store.instructions.list(VERSIONS_SHOWN).map((version) => {
      if (version.sourceLessonId !== null) {
        return { ...version, sourceText: this.store.lessons.get(version.sourceLessonId)?.text ?? null };
      }
      const source = version.sourceChatMessageId === null ? null : this.store.chat.get(version.sourceChatMessageId);
      return { ...version, sourceText: source?.text ?? null };
    });
    return {
      text: current.text,
      version: current.version?.version ?? null,
      path: this.history.file,
      versions,
      dossiersToRefresh: this.proposer.dossiersToRefresh(),
    };
  }

  chatHistory(): ChatMessage[] {
    return this.store.chat.listForTile(INSTRUCTIONS_CHAT_ID);
  }

  private addMessage(role: ChatMessage['role'], text: string): ChatMessage {
    return this.store.chat.add({ tileId: INSTRUCTIONS_CHAT_ID, topicId: '', role, text, createdAt: this.now().toISOString() });
  }

  /** Everything said here is about the instructions, so every message goes to the proposal call. */
  async chat(message: string): Promise<InstructionsChatReply> {
    const userMessage = this.addMessage('user', message);
    const answer = await this.proposer.propose(userMessage);
    const replyText = answer.proposal ? `Proposed: ${answer.proposal.summary}` : answer.reply || 'That does not change your instructions.';
    return { message: this.addMessage('agent', replyText), proposal: answer.proposal };
  }

  /** "Keep for all topics" on a lasting point from tile chat: the user's message, asked as an instructions change. */
  async propose(sourceChatMessageId: number): Promise<InstructionsProposalReply> {
    const message = this.store.chat.get(sourceChatMessageId);
    if (!message) {
      return { reply: `No chat message ${sourceChatMessageId}.`, proposal: null };
    }
    return this.proposer.propose(message);
  }

  /** "Use across topics" on a lesson: the instructions with its line added, for the user to accept, edit or reject. */
  async proposeFromLesson(lessonId: number): Promise<InstructionsProposalReply> {
    const check = checkOpenLesson(this.store, lessonId, this.now().toISOString());
    if (!check.ok) {
      return { reply: check.message, proposal: null };
    }
    return this.proposer.proposeFromLesson(check.lesson, lessonEvidence(this.store, check.lesson));
  }

  /** The proposal's source, or why it cannot be saved. */
  private source(proposal: InstructionsProposal): ProposalSource | string {
    if (proposal.sourceLessonId !== null) {
      const check = checkOpenLesson(this.store, proposal.sourceLessonId, this.now().toISOString());
      return check.ok ? { kind: 'lesson', lesson: check.lesson } : check.message;
    }
    const message = proposal.sourceChatMessageId === null ? null : this.store.chat.get(proposal.sourceChatMessageId);
    if (!message || message.role !== 'user') {
      return 'A change to your instructions must come from one of your own chat messages or a lesson you chose.';
    }
    return { kind: 'chat', message };
  }

  private proposeAgain(source: ProposalSource): Promise<InstructionsProposalReply> {
    if (source.kind === 'lesson') {
      return this.proposer.proposeFromLesson(source.lesson, lessonEvidence(this.store, source.lesson));
    }
    return this.proposer.propose(source.message);
  }

  /** A lesson's version also marks the lesson kept for all topics. */
  private write(text: string, summary: string, source: ProposalSource): InstructionsVersion {
    if (source.kind === 'chat') {
      return this.history.save(text, summary, source.message.id);
    }
    const saved = this.history.saveFromLesson(text, summary, source.lesson.id);
    this.store.lessons.decide(source.lesson.id, 'kept_all', '', saved.createdAt);
    return saved;
  }

  /**
   * Writes the accepted text and stores it as a version. When the file
   * changed on disk after the proposal, the hand edit is stored first (by
   * history.current) and nothing is written: the same request is proposed
   * again on top of the new text, for the user to decide again. A lesson
   * must still be open with its review unchanged (checkOpenLesson).
   */
  async save(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    const { proposal } = decision;
    const source = this.source(proposal);
    if (typeof source === 'string') {
      return saveFailed(source);
    }
    const text = decision.text.trim();
    if (text === '') {
      return saveFailed('Empty instructions are not saved from here. Edit the file by hand to clear it.');
    }
    if (text.length > INSTRUCTIONS_MAX_CHARS) {
      return saveFailed(`Instructions are limited to ${INSTRUCTIONS_MAX_CHARS} characters.`);
    }
    const current = this.history.current();
    const currentVersion = current.version?.version ?? null;
    if (currentVersion !== proposal.baseVersion) {
      const again = await this.proposeAgain(source);
      const message = `Your instructions changed outside the app. That edit is kept as version ${currentVersion ?? 0}; the change is proposed again on top of it.`;
      return { ok: false, message: again.proposal ? message : `${message} ${again.reply}`, undoToken: null, savedVersion: null, rebased: again.proposal };
    }
    if (`${text}\n` === current.text) {
      return saveFailed('Nothing to change: your instructions already say this.');
    }
    const summary = text === proposal.text.trim() ? proposal.summary : `${proposal.summary} (edited)`;
    const saved = this.write(`${text}\n`, summary, source);
    const refresh = this.proposer.dossiersToRefresh();
    const message = `Saved as version ${saved.version}. Will refresh ${plural(refresh, 'topic dossier', 'topic dossiers')} on next sync.`;
    return { ok: true, message, undoToken: null, savedVersion: saved.version, rebased: null };
  }
}
