import type { AgentService } from '@postpile/agent';
import { appendTailoring, mergedTailoringLines, removeTailoringLine, tailoringLines, type ActionResult, type ChatMessage, type ChatReply } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { failed, ok } from './results.ts';
import { UndoWindow } from './undo-window.ts';

/** The chat_message tile id a topic chat is stored under: no tile id starts with it. */
export function topicChatId(topicId: string): string {
  return `topic:${topicId}`;
}

/** A topic merge carries its chat along: the history shows in the target's agent pane and feeds its dossier. */
export function moveTopicChat(store: Store, from: string, to: string): void {
  store.chat.moveTopic(from, to, topicChatId(from), topicChatId(to));
}

/**
 * A topic merge carries the merged topic's tailoring along: each line joins
 * the target's, saying where it came from ("From Frontend build: ..."), and
 * is logged as kept so the target's next dossier update sees it. Without
 * this the line would stay on the archived topic, in no prompt.
 */
export function carryTailoring(store: Store, from: string, to: string, at: string): void {
  const source = store.topics.get(from);
  const target = store.topics.get(to);
  if (!source || !target) {
    return;
  }
  const lines = mergedTailoringLines(target.tailoring, source.tailoring, source.name);
  if (lines.length === 0) {
    return;
  }
  store.topics.setTailoring(to, [...tailoringLines(target.tailoring), ...lines].join('\n'), at);
  store.feedback.add({ kind: 'tailoring_kept', topicId: to, tileId: null, prKey: null, setId: null, eventId: null, note: lines.join('\n'), createdAt: at });
}

/**
 * The topic's agent chat ("Ask the agent" on the topic header, 2026-10-05).
 * A lasting point comes back for the user to place; nothing is stored until
 * they do: "Keep for this topic" / "Just this once" go to decideTailoring,
 * "Keep for all topics" to proposeInstructions and then saveInstructions on
 * Accept.
 */
export class ChatActions {
  /** Removed tailoring lines, for the toast's Undo. */
  readonly undos: UndoWindow;

  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {
    this.undos = new UndoWindow('tailoring:', now);
  }

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
    const board = Board.forTopic(this.store, this.now().toISOString(), topicId);
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
        this.store.topics.setTailoring(topicId, appendTailoring(topic.tailoring, text), at);
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

  /**
   * "Remove" on one line of the topic's tailoring ("Kept for this topic"):
   * it leaves every prompt for the topic, and the removal is logged so the
   * next dossier update stops citing it. Undo puts the line back.
   */
  removeTailoringLine(topicId: string, line: string): ActionResult {
    const topic = this.store.topics.get(topicId);
    if (!topic) {
      return failed(`no topic ${topicId}`);
    }
    const tailoring = removeTailoringLine(topic.tailoring, line);
    if (tailoring === null) {
      return failed('That line is no longer kept for this topic.');
    }
    const at = this.now().toISOString();
    const feedbackId = this.store.transaction(() => {
      this.store.topics.setTailoring(topicId, tailoring, at);
      return this.store.feedback.add({ kind: 'tailoring_removed', topicId, tileId: null, prKey: null, setId: null, eventId: null, note: line.trim(), createdAt: at }).id;
    });
    const token = this.undos.add(() => {
      // Back in its old place, unless the tailoring changed meanwhile: then at the end.
      const current = this.store.topics.get(topicId)?.tailoring ?? '';
      const restored = current === tailoring ? topic.tailoring : appendTailoring(current, line);
      this.store.transaction(() => {
        this.store.topics.setTailoring(topicId, restored, this.now().toISOString());
        this.store.feedback.delete(feedbackId);
      });
    });
    return ok('Removed. The agent stops applying it in this topic.', token);
  }
}
