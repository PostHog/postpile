import type { AgentService } from '@postpile/agent';
import type { ActionResult, ChatMessage, ChatReply, Pr, Tile, Topic } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { failed, ok } from './results.ts';

/** The chat_message tile id a topic chat is stored under: no tile id starts with it. */
export function topicChatId(topicId: string): string {
  return `topic:${topicId}`;
}

/**
 * Chat on a tile, or on a whole topic ("Ask the agent" on the topic header,
 * 2026-10-05). A lasting point comes back for the user to place; nothing
 * is stored until they do: "Keep for this topic" / "Just this once" go to
 * decideTailoring, "Keep for all topics" to proposeInstructions and then
 * saveInstructions on Accept.
 */
export class ChatActions {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {}

  getChat(tileId: string): ChatMessage[] {
    return this.store.chat.listForTile(tileId);
  }

  getTopicChat(topicId: string): ChatMessage[] {
    return this.store.chat.listForTile(topicChatId(topicId));
  }

  /**
   * One turn of a chat stored under `chatId`: the user's message, the
   * agent's answer, and the lasting point it spotted, if any. Both are
   * stored only once the answer is in, so a failed call leaves no
   * unanswered message behind; the renderer puts the text back in the input.
   */
  private async converse(chatId: string, topic: Topic, tile: Tile | null, prs: Pr[], message: string): Promise<ChatReply> {
    const history = this.store.chat.listForTile(chatId);
    const sentAt = this.now().toISOString();
    const isUnsorted = topic.id === UNSORTED_TOPIC_ID;
    const answer = await this.agent.chat({
      topic,
      tile,
      prs,
      history,
      message,
      context: this.contexts.forTopic(isUnsorted ? null : topic.id),
    });
    const { userMessage, reply } = this.store.transaction(() => ({
      userMessage: this.store.chat.add({ tileId: chatId, topicId: topic.id, role: 'user', text: message, createdAt: sentAt }),
      reply: this.store.chat.add({ tileId: chatId, topicId: topic.id, role: 'agent', text: answer.reply, createdAt: this.now().toISOString() }),
    }));
    if (!answer.lasting) {
      return { message: reply, lastingPoint: null };
    }
    // Unsorted is not a stored topic: the point can still go to all topics, not to this one.
    const topicId = isUnsorted ? null : topic.id;
    return { message: reply, lastingPoint: { topicId, text: answer.lasting.text, sourceChatMessageId: userMessage.id } };
  }

  async chat(tileId: string, message: string): Promise<ChatReply> {
    const board = Board.load(this.store, this.now().toISOString());
    const tile = board.findTile(tileId);
    const topic = tile ? board.topic(tile.topicId) : null;
    if (!tile || !topic) {
      throw new Error(`no tile ${tileId}`);
    }
    const prs = tile.members.map((m) => board.prs.get(m.prKey)).filter((pr) => pr !== undefined);
    return this.converse(tileId, topic, tile, prs, message);
  }

  /** The topic's chat: the agent sees every PR on its tiles, newest first. Unsorted works too. */
  async topicChat(topicId: string, message: string): Promise<ChatReply> {
    const board = Board.load(this.store, this.now().toISOString());
    const topic = board.topic(topicId);
    if (!topic) {
      throw new Error(`no topic ${topicId}`);
    }
    const keys = new Set(board.tilesForTopic(topicId).flatMap((tile) => tile.members.map((member) => member.prKey)));
    const prs = [...keys]
      .map((key) => board.prs.get(key))
      .filter((pr) => pr !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return this.converse(topicChatId(topicId), topic, null, prs, message);
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
