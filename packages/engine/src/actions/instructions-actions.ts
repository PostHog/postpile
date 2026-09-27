import { INSTRUCTIONS_MAX_CHARS } from '@code-manager/agent';
import type {
  ChatMessage,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { InstructionsHistory } from '../instructions/history.ts';
import type { InstructionsProposer } from '../instructions/proposer.ts';

/** chat_message tile id of the general chat in "Your instructions". It has no topic. */
export const INSTRUCTIONS_CHAT_ID = 'instructions';
const VERSIONS_SHOWN = 50;

function saveFailed(message: string): InstructionsSaveResult {
  return { ok: false, message, undoToken: null, savedVersion: null, rebased: null };
}

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
    const answer = await this.proposer.propose(userMessage, message, null);
    const replyText = answer.proposal ? `Proposed: ${answer.proposal.summary}` : answer.reply || 'That does not change your instructions.';
    return { message: this.addMessage('agent', replyText), proposal: answer.proposal };
  }

  /** "Apply to all topics instead" on a tailoring proposal: the same user message, asked as an instructions change. */
  async propose(sourceChatMessageId: number, point: string, topicId: string | null): Promise<InstructionsProposalReply> {
    const message = this.store.chat.get(sourceChatMessageId);
    if (!message) {
      return { reply: `No chat message ${sourceChatMessageId}.`, proposal: null };
    }
    return this.proposer.propose(message, point, topicId);
  }

  /**
   * Writes the accepted text and stores it as a version. When the file
   * changed on disk after the proposal, the hand edit is stored first (by
   * history.current) and nothing is written: the same request is proposed
   * again on top of the new text, for the user to decide again.
   */
  async save(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    const { proposal } = decision;
    const source = this.store.chat.get(proposal.sourceChatMessageId);
    if (!source || source.role !== 'user') {
      return saveFailed('A change to your instructions must come from one of your own chat messages.');
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
      const again = await this.proposer.propose(source, proposal.point, proposal.topicId);
      const message = `Your instructions changed outside the app. That edit is kept as version ${currentVersion ?? 0}; the change is proposed again on top of it.`;
      return { ok: false, message: again.proposal ? message : `${message} ${again.reply}`, undoToken: null, savedVersion: null, rebased: again.proposal };
    }
    if (`${text}\n` === current.text) {
      return saveFailed('Nothing to change: your instructions already say this.');
    }
    const summary = text === proposal.text.trim() ? proposal.summary : `${proposal.summary} (edited)`;
    const saved = this.history.save(`${text}\n`, summary, source.id);
    const refresh = this.proposer.dossiersToRefresh();
    const message = `Saved as version ${saved.version}. Will refresh ${plural(refresh, 'topic dossier', 'topic dossiers')} on next sync.`;
    return { ok: true, message, undoToken: null, savedVersion: saved.version, rebased: null };
  }
}
