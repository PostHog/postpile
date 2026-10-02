import { describe, expect, it } from 'vitest';
import { dossierBehindNote, staleBadge, staleGlanceNote, staleLead, staleVerdictTitle, staleWord, updatingNow } from './staleness.ts';

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

  it('leads notes and check lines with the same word', () => {
    expect(staleLead(true)).toBe('Updating now');
    expect(staleLead(false)).toBe('Out of date');
  });

  it('words a stale memory badge for both cases', () => {
    expect(staleBadge('PR moved since', true)).toBe('updating · PR moved since');
    expect(staleBadge('PR moved since', false)).toBe('out of date · PR moved since');
  });

  it('words the stale verdict box line: updating, rewritten on look, or only on the next sync', () => {
    expect(staleGlanceNote(true, false)).toBe('Written before the last change. Updating now: a new assessment is being written.');
    expect(staleGlanceNote(false, false)).toBe('Written before the last change. A new assessment is written when you stay on this PR.');
    expect(staleGlanceNote(false, true)).toBe('Written before the last change. A new assessment will be written on the next sync.');
  });

  it('starts the chip tooltip with the same word', () => {
    expect(staleVerdictTitle(true, false)).toMatch(/^Updating now:/);
    expect(staleVerdictTitle(false, false)).toMatch(/^Out of date:.*Opening the PR writes a new one\.$/);
    expect(staleVerdictTitle(false, true)).toMatch(/^Out of date:.*The next sync writes a new one\.$/);
  });

  it('counts the events the dossier trails', () => {
    expect(dossierBehindNote(3, true)).toBe('Updating now: 3 newer events.');
    expect(dossierBehindNote(1, true)).toBe('Updating now: 1 newer event.');
    expect(dossierBehindNote(2, false)).toBe('Out of date: 2 newer events not in the dossier yet.');
  });
});
