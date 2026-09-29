// One wording for "not up to date" (2026-09-29): "updating" while a full
// sync or a catch-up run for the topic is going, else "out of date".
// The glance card, the tile's verdict chip, the dossier's newer-events note
// and memory badges all take their words from here.

export interface UpdatingInput {
  /** A full sync runs (`useActions().syncing`, any sync, also background ones). */
  syncing: boolean;
  /** A catch-up run on the topic is writing (`glanceState === 'writing'` on the PR or a PR of the topic). */
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

/** The one line in a stale verdict box, in place of its advice lines. */
export function staleGlanceNote(updating: boolean): string {
  return updating
    ? 'Written before the last change. Updating now: a new assessment is being written.'
    : 'Written before the last change. A new assessment will be written on the next sync.';
}

/** The verdict chip's tooltip on a stale glance. */
export function staleVerdictTitle(updating: boolean): string {
  return updating
    ? 'Updating now: this verdict was written before the last change to the PR or your instructions.'
    : 'Out of date: this verdict was written before the last change to the PR or your instructions. The next sync writes a new one.';
}

/** Under "Since you last looked" when the dossier trails the event log: "Updating now: 3 newer events." */
export function dossierBehindNote(eventsBehind: number, updating: boolean): string {
  const events = `${eventsBehind} newer ${eventsBehind === 1 ? 'event' : 'events'}`;
  return updating ? `Updating now: ${events}.` : `Out of date: ${events} not in the dossier yet.`;
}
