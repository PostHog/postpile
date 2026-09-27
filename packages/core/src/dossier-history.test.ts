import { describe, expect, it } from 'vitest';
import { emptyDossier } from './dossier.ts';
import { dossierChanges, dossierVersionNotes } from './dossier-history.ts';
import { at, makeDossierVersion } from './fixtures.ts';

const first = {
  ...emptyDossier(),
  status: 'active' as const,
  people: [{ login: 'rowan', role: 'driver' as const, note: '' }],
  openQuestions: [{ text: 'Keep GitHub runners for releases?', askedBy: 'lyra', refs: [] }],
  timeline: [{ prKey: 'PostHog/posthog#1', role: 'config' }],
};

const second = {
  ...first,
  status: 'blocked' as const,
  people: [...first.people, { login: 'lyra', role: 'reviewer' as const, note: '' }],
  openQuestions: [],
  timeline: [...first.timeline, { prKey: 'PostHog/posthog#2', role: 'cache' }],
};

describe('dossierChanges', () => {
  it('names status, people, questions and PRs that moved', () => {
    expect(dossierChanges(first, second)).toEqual([
      'Status: active → blocked',
      'Person added: @lyra (reviewer)',
      'Question closed: Keep GitHub runners for releases?',
      'PR joined: PostHog/posthog#2',
    ]);
  });

  it('is empty when nothing a reader would notice changed', () => {
    expect(dossierChanges(first, { ...first, summary: 'reworded' })).toEqual([]);
  });
});

describe('dossierVersionNotes', () => {
  it('compares each version to the one before, newest first', () => {
    const versions = [
      makeDossierVersion({ version: 2, dossier: second, createdAt: at(10) }),
      makeDossierVersion({ version: 1, dossier: first, createdAt: at(0) }),
    ];
    const notes = dossierVersionNotes(versions);
    expect(notes.map((note) => note.version)).toEqual([2, 1]);
    expect(notes[0]?.changes).toContain('Status: active → blocked');
    expect(notes[1]?.changes).toEqual([]);
  });

  it('uses the extra older version only for comparison', () => {
    const versions = [
      makeDossierVersion({ version: 2, dossier: second }),
      makeDossierVersion({ version: 1, dossier: first }),
    ];
    expect(dossierVersionNotes(versions, 1)).toHaveLength(1);
  });
});
