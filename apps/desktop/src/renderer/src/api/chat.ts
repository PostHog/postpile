import { useQuery } from '@tanstack/react-query';
import type { ChatMessage } from '@code-manager/core';
import { request, tilePath } from './client.ts';
import { queryKeys } from './keys.ts';

/** Tile chat history. Only fetched while the chat is open. */
export function useChat(tileId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chat(tileId),
    queryFn: () => request<ChatMessage[]>('GET', `${tilePath(tileId)}/chat`),
    enabled,
  });
}
