import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, ChatRole } from '@code-manager/core';
import { all, insertReturningId } from '../sql.ts';

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

  /** Oldest first. */
  listForTile(tileId: string): ChatMessage[] {
    return all<ChatRow>(this.db, 'SELECT * FROM chat_message WHERE tile_id = ? ORDER BY id', tileId).map(toMessage);
  }
}
