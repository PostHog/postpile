import type { InstructionsProposal } from '@postpile/core';

/** A stable React key for a proposal card: its one source, a chat message or a lesson. */
export function proposalKey(proposal: InstructionsProposal): string {
  return proposal.sourceLessonId !== null ? `lesson:${proposal.sourceLessonId}` : `chat:${proposal.sourceChatMessageId}`;
}
