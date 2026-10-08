import type { PrNotesView, PrNoteView } from '@postpile/core';
import { ageLabel } from './time.ts';

export interface AgentNoteLine {
  noteId: string;
  /** "covered by acme/app#1851 · ph3 session · 40m: reviewed with the parent". */
  text: string;
  /** Why it is stale, or null while it holds. */
  stale: string | null;
}

function kindWords(note: PrNoteView): string {
  if (note.kind === 'covered') {
    return `covered by ${note.coveredBy ?? 'another PR'}`;
  }
  return note.kind === 'no_action' ? 'no action needed' : 'on it now';
}

function lineOf(note: PrNoteView, now: Date): AgentNoteLine {
  return {
    noteId: note.id,
    text: `${kindWords(note)} · ${note.by} · ${ageLabel(note.createdAt, now)}: ${note.note}`,
    stale: note.status === 'stale' ? note.staleReasons.join('; ') : null,
  };
}

/**
 * The PR pane's agent note lines (DESIGN.md "Agent notes on PRs"): the
 * durable note and the lease, live or stale; an ended lease is left out.
 * Advisory only: nothing here changes the PR's move or state.
 */
export function agentNoteLines(notes: PrNotesView, now: Date): AgentNoteLine[] {
  const shown = [notes.durable, notes.lease].filter((note): note is PrNoteView => note !== null && note.status !== 'expired');
  return shown.map((note) => lineOf(note, now));
}
