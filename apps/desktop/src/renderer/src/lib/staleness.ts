// One wording for "not up to date" (2026-09-29): "updating" while a full
// sync or a catch-up run for the topic is going, else "out of date".
// The glance card, the tile's verdict chip, the dossier's newer-events note
// and memory badges all take their words from here.

export interface UpdatingInput {
  /** A full sync runs (`useActions().syncing`, any sync, also background ones). */
  syncing: boolean;
  /**
   * A catch-up run is writing: for a glance, `glanceState === 'writing'` on
   * the PR (also a glance-only refresh on look); for memory (dossier,
   * facts), the server's `memoryUpdating` (whole-topic runs only).
   */
  writing: boolean;
}

export type StaleWord = 'updating' | 'out of date';

export function updatingNow(input: UpdatingInput): boolean {
  return input.syncing || input.writing;
}

/** The short word after a verdict or on a badge: "Look closer · updating" / "· out of date". */
export function staleWord(updating: boolean): StaleWord {
  return updating ? 'updating' : 'out of date';
}

/** The capitalised lead of a note or check line: "Updating now: …" / "Out of date: …". */
export function staleLead(updating: boolean): string {
  return updating ? 'Updating now' : 'Out of date';
}

/** The badge after a stale memory line: "updating · PR moved since" / "out of date · PR moved since". */
export function staleBadge(reasonLabel: string, updating: boolean): string {
  return `${staleWord(updating)} · ${reasonLabel}`;
}

/**
 * The one line in a stale verdict box, in place of its advice lines.
 * `waitsForSync`: the server says looking at the PR cannot rewrite it
 * (`glanceRefreshBlock` set: daily cap spent, catch-up or agent off), so
 * only the next sync will (DESIGN.md "Glance refresh on look").
 */
export function staleGlanceNote(updating: boolean, waitsForSync: boolean): string {
  if (updating) {
    return 'Written before the last change. Updating now: a new assessment is being written.';
  }
  return waitsForSync
    ? 'Written before the last change. A new assessment will be written on the next sync.'
    : 'Written before the last change. A new assessment is written when you stay on this PR.';
}

/** The verdict chip's tooltip on a stale glance; `waitsForSync` as in `staleGlanceNote`. */
export function staleVerdictTitle(updating: boolean, waitsForSync: boolean): string {
  if (updating) {
    return 'Updating now: this verdict was written before the last change to the PR or your instructions.';
  }
  const next = waitsForSync ? 'The next sync writes a new one.' : 'Opening the PR writes a new one.';
  return `Out of date: this verdict was written before the last change to the PR or your instructions. ${next}`;
}

/** Under "Since you last looked" when the dossier trails the event log: "Updating now: 3 newer events." */
export function dossierBehindNote(eventsBehind: number, updating: boolean): string {
  const events = `${eventsBehind} newer ${eventsBehind === 1 ? 'event' : 'events'}`;
  return updating ? `${staleLead(true)}: ${events}.` : `${staleLead(false)}: ${events} not in the dossier yet.`;
}
