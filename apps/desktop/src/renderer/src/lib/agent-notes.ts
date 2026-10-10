import type { PrNotesView, PrNoteView } from '@postpile/core';
import { ageLabel, clockLabel } from './time.ts';

export interface AgentNoteLine {
  noteId: string;
  /** "covered by acme/app#1851 · ph3 session · 40m: reviewed with the parent". */
  text: string;
  /** Why it is out of date, or null while it holds. */
  stale: string | null;
  /** The tooltip: the full line, why it is out of date, and when a lease ends. */
  title: string;
}

function kindWords(note: PrNoteView): string {
  if (note.kind === 'covered') {
    // Accepted without a review on the cover (notes are advisory), but never shown as a fact.
    const noReview = note.coverReviewed === false ? ' (no review yet)' : '';
    return `covered by ${note.coveredBy ?? 'another PR'}${noReview}`;
  }
  if (note.kind === 'no_action') {
    return 'no action needed';
  }
  // A lease whose PR moved on no longer says the agent is on it now.
  return note.status === 'stale' ? 'was on it' : 'on it now';
}

function titleOf(note: PrNoteView, text: string, stale: string | null): string {
  const lines = [`Agent note: ${text}`];
  if (stale) {
    lines.push(`Out of date: ${stale}`);
  }
  if (note.expiresAt) {
    lines.push(`Lease ends at ${clockLabel(new Date(note.expiresAt))}`);
  }
  return lines.join('\n');
}

function lineOf(note: PrNoteView, now: Date): AgentNoteLine {
  const text = `${kindWords(note)} · ${note.by} · ${ageLabel(note.createdAt, now)}: ${note.note}`;
  const stale = note.status === 'stale' ? note.staleReasons.join('; ') : null;
  return { noteId: note.id, text, stale, title: titleOf(note, text, stale) };
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
