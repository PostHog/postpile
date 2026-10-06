import type { ReviewNoteSource } from '@postpile/core';

/**
 * Where a sent review note came from, for telemetry: the agent's last draft
 * as is, that draft changed by the user, or the user's own text when the
 * agent never drafted. Whitespace at the ends does not count as an edit.
 */
export function reviewNoteSource(sent: string, agentDraft: string | null): ReviewNoteSource {
  if (agentDraft === null) {
    return 'own';
  }
  return sent.trim() === agentDraft.trim() ? 'agent' : 'agent_edited';
}
