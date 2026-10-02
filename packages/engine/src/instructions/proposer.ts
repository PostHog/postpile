import type { AgentService } from '@postpile/agent';
import { onlyAddsLesson, type ChatMessage, type InstructionsProposalReply, type Lesson } from '@postpile/core';
import type { Store } from '@postpile/store';
import { contextHashKey } from '../digest/dossiers.ts';
import type { InstructionsHistory } from './history.ts';

/** Earlier user messages from the same chat that go along as context. */
const EARLIER_MESSAGES = 5;

/**
 * Turns one of the user's own chat messages, or a lesson they chose to use
 * across topics, into an instructions proposal. A chat source sends only
 * the user's words; a lesson sends its line, with the review it came from
 * fenced as GitHub text, and may only add that line (`onlyAddsLesson`).
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

  async propose(message: ChatMessage): Promise<InstructionsProposalReply> {
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
        sourceChatMessageId: message.id,
        sourceLessonId: null,
        dossiersToRefresh: this.dossiersToRefresh(),
      },
    };
  }

  /** The caller checked that the lesson is open and its review unchanged (checkOpenLesson). */
  async proposeFromLesson(lesson: Lesson, evidence: string): Promise<InstructionsProposalReply> {
    const current = this.history.current();
    const answer = await this.agent.proposeInstructionsFromLesson({ instructions: current.text, lesson: lesson.text, evidence });
    if (!answer.change) {
      return { reply: answer.reply, proposal: null };
    }
    if (!onlyAddsLesson(current.text, answer.change.text)) {
      return { reply: 'The proposed change rewrote more than this one lesson, so it was dropped. Try again, or add the line by hand.', proposal: null };
    }
    return {
      reply: answer.reply,
      proposal: {
        baseVersion: current.version?.version ?? null,
        baseText: current.text,
        text: answer.change.text,
        summary: answer.change.summary,
        sourceChatMessageId: null,
        sourceLessonId: lesson.id,
        dossiersToRefresh: this.dossiersToRefresh(),
      },
    };
  }
}
