import { useQuery } from '@tanstack/react-query';
import type { ChatMessage, InstructionsView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** instructions.md with its version history. */
export function useInstructions() {
  return useQuery({
    queryKey: queryKeys.instructions,
    queryFn: () => request<InstructionsView>('GET', '/api/instructions'),
  });
}

/** The general chat in "Your instructions". */
export function useInstructionsChat() {
  return useQuery({
    queryKey: queryKeys.instructionsChat,
    queryFn: () => request<ChatMessage[]>('GET', '/api/instructions/chat'),
  });
}
