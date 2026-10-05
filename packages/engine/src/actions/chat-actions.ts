import type { AgentService } from '@postpile/agent';
import type { ActionResult, ChatMessage, ChatReply } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { failed, ok } from './results.ts';

/** The chat_message tile id a topic chat is stored under: no tile id starts with it. */
export function topicChatId(topicId: string): string {
  return `topic:${topicId}`;
}

/** A topic merge carries its chat along: the history shows in the target's agent pane and feeds its dossier. */
export function moveTopicChat(store: Store, from: string, to: string): void {
  store.chat.moveTopic(from, to, topicChatId(from), topicChatId(to));
}

/**
 * The topic's agent chat ("Ask the agent" on the topic header, 2026-10-05).
 * A lasting point comes back for the user to place; nothing is stored until
 * they do: "Keep for this topic" / "Just this once" go to decideTailoring,
 * "Keep for all topics" to proposeInstructions and then saveInstructions on
 * Accept.
 */
export class ChatActions {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {}

  getTopicChat(topicId: string): ChatMessage[] {
    return this.store.chat.listForTile(topicChatId(topicId));
  }

  /**
   * One turn of the topic's chat: the user's message, the agent's answer,
   * and the lasting point it spotted, if any. The agent sees every PR on the
   * topic's tiles, newest first; Unsorted works too. Both messages are
   * stored only once the answer is in, so a failed call leaves no unanswered
   * message behind; the renderer puts the text back in the input.
   */
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
    const chatId = topicChatId(topicId);
    const history = this.store.chat.listForTile(chatId);
    const isUnsorted = topicId === UNSORTED_TOPIC_ID;
    const answer = await this.agent.chat({ topic, prs, history, message, context: this.contexts.forTopic(isUnsorted ? null : topicId) });
    // Stamped when stored, not when sent: a dossier saved while the agent answered must not end up newer
    // than the turn, or the next dossier update (which reads turns since the last version) never sees it.
    const storedAt = this.now().toISOString();
    const { userMessage, reply } = this.store.transaction(() => ({
      userMessage: this.store.chat.add({ tileId: chatId, topicId, role: 'user', text: message, createdAt: storedAt }),
      reply: this.store.chat.add({ tileId: chatId, topicId, role: 'agent', text: answer.reply, createdAt: storedAt }),
    }));
    if (!answer.lasting) {
      return { message: reply, lastingPoint: null };
    }
    // Unsorted is not a stored topic: the point can still go to all topics, not to this one.
    return { message: reply, lastingPoint: { topicId: isUnsorted ? null : topicId, text: answer.lasting.text, sourceChatMessageId: userMessage.id } };
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
