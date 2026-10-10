// How agent notes on PRs read in the MCP answers (DESIGN.md "Agent notes on
// PRs"). Note text, `by` and the client name are untrusted: every line here
// goes inside the <postpile-data> fence. Only the observation token, a hash
// PostPile made, is printed outside it.
import type { PrNotesView, PrNoteView } from '@postpile/core';
import { ago } from './text.ts';

/** "1 h 20 min", "2 h", "45 min", "under a minute": how long until `iso`. */
export function untilText(iso: string, now: Date): string {
  const minutes = Math.floor((Date.parse(iso) - now.getTime()) / 60_000);
  if (minutes < 1) {
    return 'under a minute';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** "covered by acme/app#1851", "covered by acme/app#1851 (no review yet)" or "no action needed". */
function durableWords(note: PrNoteView): string {
  if (note.kind !== 'covered') {
    return 'no action needed';
  }
  const noReview = note.coverReviewed === false ? ' (no review yet)' : '';
  return `covered by ${note.coveredBy ?? 'another PR'}${noReview}`;
}

/** The app's words for a stale note, so the PR pane and the answers agree. */
function staleWords(note: PrNoteView): string {
  return `out of date: ${note.staleReasons.join('; ')}`;
}

/**
 * whats_on_me's line under a PR, or null when there is nothing to say:
 * "agent note (ph3 session, 40 min ago): covered by acme/app#1851: <note>",
 * "ph3 session is on it, 40 min ago, lease ends in 1 h 20: <note>".
 * A stale note says so in a few words; an expired lease is left out.
 */
export function queueNoteLines(view: PrNotesView, now: Date): string[] {
  const lines: string[] = [];
  const { durable, lease } = view;
  if (durable?.status === 'live') {
    lines.push(`agent note (${durable.by}, ${ago(durable.createdAt, now)}): ${durableWords(durable)}: ${durable.note}`);
  } else if (durable?.status === 'stale') {
    lines.push(`agent note (${durable.by}, ${ago(durable.createdAt, now)}) is ${staleWords(durable)}; pr_context has it`);
  }
  if (lease?.status === 'live' && lease.expiresAt) {
    lines.push(`${lease.by} is on it, ${ago(lease.createdAt, now)}, lease ends in ${untilText(lease.expiresAt, now)}: ${lease.note}`);
  } else if (lease?.status === 'stale') {
    lines.push(`${lease.by} was on it (${ago(lease.createdAt, now)}), lease is ${staleWords(lease)}`);
  }
  return lines;
}

function who(note: PrNoteView, now: Date): string {
  return `by ${note.by} via ${note.client}, ${ago(note.createdAt, now)}, id ${note.id}`;
}

function durableLine(note: PrNoteView, now: Date): string[] {
  const head = note.status === 'live' ? 'Agent note' : `Agent note (${staleWords(note)})`;
  const lines = [`${head}: ${durableWords(note)} (${who(note, now)}): ${note.note}`];
  if (note.coveredBy) {
    const fetched = note.coverFetchedAt ? `fetched from GitHub ${ago(note.coverFetchedAt, now)}` : 'not stored';
    lines.push(`  ${note.coveredBy} is ${fetched}.`);
  }
  return lines;
}

function leaseLine(note: PrNoteView, now: Date): string {
  if (note.status === 'expired') {
    return `Lease ended ${note.expiresAt ? ago(note.expiresAt, now) : ''}: ${note.by} was on it (${who(note, now)}): ${note.note}`;
  }
  const until = note.expiresAt ? `, lease ends in ${untilText(note.expiresAt, now)}` : '';
  const head = note.status === 'live' ? `In progress: ${note.by} is on it` : `In progress (${staleWords(note)}): ${note.by} was on it`;
  return `${head}${until} (${who(note, now)}): ${note.note}`;
}

/** pr_context's note lines: the current note of each slot with its id, why it is stale, and the one it replaced. Empty when there are none. */
export function contextNoteLines(view: PrNotesView, now: Date): string[] {
  const lines: string[] = [];
  if (view.durable) {
    lines.push(...durableLine(view.durable, now));
  }
  if (view.lease) {
    lines.push(leaseLine(view.lease, now));
  }
  if (view.replaced) {
    const kind = view.replaced.kind === 'in_progress' ? 'in_progress' : durableWords(view.replaced);
    lines.push(`Replaced: ${kind} by ${view.replaced.by} (${ago(view.replaced.createdAt, now)})`);
  }
  return lines;
}

function noteJson(note: PrNoteView | null): object | null {
  if (!note) {
    return null;
  }
  const { id, kind, coveredBy, coverFetchedAt, coverReviewed, createdAt, expiresAt, status, staleReasons } = note;
  // The note, the agent's label and its client name are agent-written: untrusted, like GitHub text.
  return { id, kind, coveredBy, coverFetchedAt, coverReviewed, createdAt, expiresAt, status, untrusted: { note: note.note, by: note.by, client: note.client, staleReasons } };
}

/** pr_context's JSON: the observation token and the notes, free text under "untrusted". */
export function notesJson(view: PrNotesView): object {
  return { observationToken: view.token, durable: noteJson(view.durable), lease: noteJson(view.lease), replaced: noteJson(view.replaced) };
}

/** Outside the fence: the token note_pr needs. */
export function tokenLine(view: PrNotesView): string {
  return `Observation token for note_pr: ${view.token} (it changes when the PR does).`;
}
