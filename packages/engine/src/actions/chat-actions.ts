import type { AgentService } from '@code-manager/agent';
import type { ActionResult, ChatMessage, ChatReply, InstructionsProposal } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import { errorText } from '../errors.ts';
import type { InstructionsProposer } from '../instructions/proposer.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { failed, ok } from './results.ts';

/**
 * Chat on a tile. Nothing from chat is stored until the user confirms it:
 * tailoring with decideTailoring ("keep it" vs "just this once"), an
 * instructions change with saveInstructions.
 */
export class ChatActions {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly proposer: InstructionsProposer,
    private readonly now: () => Date,
  ) {}

  /**
   * A point the agent says applies everywhere becomes an instructions
   * proposal from the user's own message. When that call finds no change,
   * or fails, the point falls back to tailoring for this topic.
   */
  private async instructionsProposal(userMessage: ChatMessage, point: string, topicId: string | null): Promise<InstructionsProposal | null> {
    try {
      return (await this.proposer.propose(userMessage, point, topicId)).proposal;
    } catch (error) {
      console.warn(`instructions proposal failed: ${errorText(error)}`);
      return null;
    }
  }

  getChat(tileId: string): ChatMessage[] {
    return this.store.chat.listForTile(tileId);
  }

  async chat(tileId: string, message: string): Promise<ChatReply> {
    const board = Board.load(this.store, this.now().toISOString());
    const tile = board.findTile(tileId);
    const topic = tile ? board.topic(tile.topicId) : null;
    if (!tile || !topic) {
      throw new Error(`no tile ${tileId}`);
    }
    const history = this.store.chat.listForTile(tileId);
    const userMessage = this.store.chat.add({ tileId, topicId: topic.id, role: 'user', text: message, createdAt: this.now().toISOString() });
    const prs = tile.members.map((m) => board.prs.get(m.prKey)).filter((pr) => pr !== undefined);
    const isUnsorted = topic.id === UNSORTED_TOPIC_ID;
    const answer = await this.agent.chat({
      topic,
      tile,
      prs,
      history,
      message,
      context: this.contexts.forTopic(isUnsorted ? null : topic.id),
    });
    const reply = this.store.chat.add({
      tileId,
      topicId: topic.id,
      role: 'agent',
      text: answer.reply,
      createdAt: this.now().toISOString(),
    });
    const lasting = answer.lasting;
    const storedTopicId = isUnsorted ? null : topic.id;
    if (lasting?.scope === 'all') {
      const instructionsProposal = await this.instructionsProposal(userMessage, lasting.text, storedTopicId);
      if (instructionsProposal) {
        return { message: reply, tailoringProposal: null, instructionsProposal };
      }
    }
    // Unsorted is not a stored topic, so there is nowhere to keep tailoring.
    const tailoringProposal =
      lasting && storedTopicId !== null ? { topicId: storedTopicId, text: lasting.text, sourceChatMessageId: userMessage.id } : null;
    return { message: reply, tailoringProposal, instructionsProposal: null };
  }

  /** keep=true appends the text to the topic's tailoring; false only logs it for this once. */
  decideTailoring(topicId: string, text: string, keep: boolean): ActionResult {
    const topic = this.store.topics.get(topicId);
    if (!topic) {
      return failed(`no topic ${topicId}`);
    }
    const at = this.now().toISOString();
    this.store.transaction(() => {
      if (keep) {
        const tailoring = topic.tailoring.trim() ? `${topic.tailoring.trim()}\n${text.trim()}` : text.trim();
        this.store.topics.setTailoring(topicId, tailoring, at);
      }
      this.store.feedback.add({
        kind: keep ? 'tailoring_kept' : 'tailoring_once',
        topicId,
        tileId: null,
        prKey: null,
        setId: null,
        eventId: null,
        note: text,
        createdAt: at,
      });
    });
    return ok(keep ? 'Kept for this topic' : 'Used just this once');
  }
}
