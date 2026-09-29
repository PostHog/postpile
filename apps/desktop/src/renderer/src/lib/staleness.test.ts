import { describe, expect, it } from 'vitest';
import { dossierBehindNote, staleGlanceNote, staleVerdictTitle, staleWord, updatingNow } from './staleness.ts';

describe('updatingNow', () => {
  it('is true while a full sync or a catch-up run is going', () => {
    expect(updatingNow({ syncing: true, writing: false })).toBe(true);
    expect(updatingNow({ syncing: false, writing: true })).toBe(true);
    expect(updatingNow({ syncing: false, writing: false })).toBe(false);
  });
});

describe('staleness wording', () => {
  it('says updating while something runs, out of date otherwise', () => {
    expect(staleWord(true)).toBe('updating');
    expect(staleWord(false)).toBe('out of date');
  });

  it('words the stale verdict box line for both cases', () => {
    expect(staleGlanceNote(true)).toBe('Written before the last change. Updating now: a new assessment is being written.');
    expect(staleGlanceNote(false)).toBe('Written before the last change. A new assessment will be written on the next sync.');
  });

  it('starts the chip tooltip with the same word', () => {
    expect(staleVerdictTitle(true)).toMatch(/^Updating now:/);
    expect(staleVerdictTitle(false)).toMatch(/^Out of date:/);
  });

  it('counts the events the dossier trails', () => {
    expect(dossierBehindNote(3, true)).toBe('Updating now: 3 newer events.');
    expect(dossierBehindNote(1, true)).toBe('Updating now: 1 newer event.');
    expect(dossierBehindNote(2, false)).toBe('Out of date: 2 newer events not in the dossier yet.');
  });
});
