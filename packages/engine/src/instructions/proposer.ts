import type { AgentService } from '@code-manager/agent';
import type { ChatMessage, InstructionsProposalReply } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { contextHashKey } from '../digest/dossiers.ts';
import type { InstructionsHistory } from './history.ts';

/** Earlier user messages from the same chat that go along as context. */
const EARLIER_MESSAGES = 5;

/**
 * Turns one of the user's own chat messages into an instructions proposal.
 * Only a stored user message can be the source, never agent text or GitHub
 * text, and only its words go to the agent.
 */
export class InstructionsProposer {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly history: InstructionsHistory,
  ) {}

  /**
   * Topics whose dossier refreshes once after an instructions change: those
   * with a stored context hash. Topics without one count as unchanged (see
   * DossierUpdater), so they are not promised a refresh.
   */
  dossiersToRefresh(): number {
    return this.store.topics.listActive().filter((topic) => this.store.meta.get(contextHashKey(topic.id)) !== null).length;
  }

  private earlierMessages(message: ChatMessage): string[] {
    return this.store.chat
      .listForTile(message.tileId)
      .filter((earlier) => earlier.role === 'user' && earlier.id < message.id)
      .slice(-EARLIER_MESSAGES)
      .map((earlier) => earlier.text);
  }

  /** point: the lasting point in the user's words, kept so "only this topic" can store it as tailoring instead. */
  async propose(message: ChatMessage, point: string, topicId: string | null): Promise<InstructionsProposalReply> {
    if (message.role !== 'user') {
      return { reply: 'Only your own messages can change your instructions.', proposal: null };
    }
    const current = this.history.current();
    const answer = await this.agent.proposeInstructionsChange({
      instructions: current.text,
      message: message.text,
      earlierMessages: this.earlierMessages(message),
    });
    if (!answer.change) {
      return { reply: answer.reply, proposal: null };
    }
    return {
      reply: answer.reply,
      proposal: {
        baseVersion: current.version?.version ?? null,
        baseText: current.text,
        text: answer.change.text,
        summary: answer.change.summary,
        point,
        topicId,
        sourceChatMessageId: message.id,
        dossiersToRefresh: this.dossiersToRefresh(),
      },
    };
  }
}
