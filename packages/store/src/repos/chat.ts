import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, ChatRole } from '@code-manager/core';
import { all, insertReturningId, one } from '../sql.ts';

export type NewChatMessage = Omit<ChatMessage, 'id'>;

interface ChatRow {
  id: number;
  tile_id: string;
  topic_id: string;
  role: string;
  text: string;
  created_at: string;
}

function toMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    tileId: row.tile_id,
    topicId: row.topic_id,
    role: row.role as ChatRole,
    text: row.text,
    createdAt: row.created_at,
  };
}

export class ChatRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(message: NewChatMessage): ChatMessage {
    const id = insertReturningId(
      this.db,
      'INSERT INTO chat_message (tile_id, topic_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)',
      message.tileId,
      message.topicId,
      message.role,
      message.text,
      message.createdAt,
    );
    return { id, ...message };
  }

  get(id: number): ChatMessage | null {
    const row = one<ChatRow>(this.db, 'SELECT * FROM chat_message WHERE id = ?', id);
    return row ? toMessage(row) : null;
  }

  /** The user's own messages in a topic after `since`, newest `limit` of them, oldest first. */
  listUserForTopicSince(topicId: string, since: string, limit: number): ChatMessage[] {
    const rows = all<ChatRow>(
      this.db,
      "SELECT * FROM chat_message WHERE topic_id = ? AND role = 'user' AND created_at > ? ORDER BY id DESC LIMIT ?",
      topicId,
      since,
      limit,
    );
    return rows.map(toMessage).reverse();
  }

  /** Oldest first. */
  listForTile(tileId: string): ChatMessage[] {
    return all<ChatRow>(this.db, 'SELECT * FROM chat_message WHERE tile_id = ? ORDER BY id', tileId).map(toMessage);
  }
}
