import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage } from '@code-manager/core';

export type NewChatMessage = Omit<ChatMessage, 'id'>;

export class ChatRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(_message: NewChatMessage): ChatMessage {
    throw new Error('not implemented');
  }

  /** Oldest first. */
  listForTile(_tileId: string): ChatMessage[] {
    throw new Error('not implemented');
  }
}
