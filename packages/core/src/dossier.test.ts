import { describe, expect, it } from 'vitest';
import { clampDossier, clipText, DOSSIER_LIMITS, dossierBrief, emptyDossier } from './dossier.ts';
import { at } from './fixtures.ts';
import type { Dossier } from './memory.ts';

function longText(length: number): string {
  return 'x'.repeat(length);
}

function bigDossier(): Dossier {
  return {
    goal: longText(1000),
    summary: longText(1000),
    status: 'active',
    statusNote: longText(1000),
    people: Array.from({ length: 12 }, (_, i) => ({ login: `p${i}`, role: 'contributor' as const, note: longText(500) })),
    openQuestions: Array.from({ length: 12 }, (_, i) => ({ text: `q${i} ${longText(500)}`, askedBy: null, refs: [] })),
    timeline: Array.from({ length: 50 }, (_, i) => ({ prKey: `acme/app#${i}`, role: longText(500) })),
    earlier: longText(1000),
    userCares: Array.from({ length: 10 }, (_, i) => ({ text: `c${i} ${longText(500)}`, source: 'observed' as const })),
    recentChanges: Array.from({ length: 20 }, (_, i) => ({ at: at(100 - i), text: `r${i} ${longText(500)}`, refs: [] })),
  };
}

describe('clipText', () => {
  it('leaves short text alone and marks a cut', () => {
    expect(clipText('  hello  ', 10)).toBe('hello');
    const clipped = clipText('abcdefghij', 5);
    expect(clipped).toBe('abcd…');
    expect(clipped.length).toBe(5);
  });
});

describe('clampDossier', () => {
  it('cuts every string and list to its limit', () => {
    const clamped = clampDossier(bigDossier());
    expect(clamped.goal.length).toBe(DOSSIER_LIMITS.goal);
    expect(clamped.summary.length).toBe(DOSSIER_LIMITS.summary);
    expect(clamped.statusNote.length).toBe(DOSSIER_LIMITS.statusNote);
    expect(clamped.earlier.length).toBe(DOSSIER_LIMITS.earlier);
    expect(clamped.people).toHaveLength(DOSSIER_LIMITS.people);
    expect(clamped.people[0]?.note.length).toBe(DOSSIER_LIMITS.personNote);
    expect(clamped.openQuestions).toHaveLength(DOSSIER_LIMITS.openQuestions);
    expect(clamped.openQuestions[0]?.text.length).toBe(DOSSIER_LIMITS.questionText);
    expect(clamped.timeline).toHaveLength(DOSSIER_LIMITS.timeline);
    expect(clamped.timeline[0]?.role.length).toBe(DOSSIER_LIMITS.timelineRole);
    expect(clamped.userCares).toHaveLength(DOSSIER_LIMITS.userCares);
    expect(clamped.recentChanges).toHaveLength(DOSSIER_LIMITS.recentChanges);
    expect(clamped.recentChanges[0]?.text.length).toBe(DOSSIER_LIMITS.changeText);
  });

  it('keeps the newest timeline entries and the newest recent changes', () => {
    const clamped = clampDossier(bigDossier());
    expect(clamped.timeline[0]?.prKey).toBe('acme/app#10');
    expect(clamped.timeline.at(-1)?.prKey).toBe('acme/app#49');
    expect(clamped.recentChanges[0]?.text.startsWith('r0 ')).toBe(true);
    expect(clamped.openQuestions[0]?.text.startsWith('q0 ')).toBe(true);
  });

  it('does not change a dossier inside the limits', () => {
    const dossier: Dossier = { ...emptyDossier(), goal: 'Run CI on Depot', timeline: [{ prKey: 'a/b#1', role: 'image' }] };
    expect(clampDossier(dossier)).toEqual(dossier);
  });
});

describe('dossierBrief', () => {
  const depot: Dossier = {
    ...emptyDossier(),
    goal: 'Run all CI on Depot runners to cut cost and queue time.',
    status: 'blocked',
    statusNote: 'waiting on the runner image PR',
    people: [
      { login: 'alice', role: 'driver', note: 'owns the rollout' },
      { login: 'bob', role: 'reviewer', note: '' },
    ],
  };

  it('says goal, status and driver', () => {
    expect(dossierBrief(depot)).toBe(
      'Run all CI on Depot runners to cut cost and queue time. Status: blocked - waiting on the runner image PR. Driver: @alice.',
    );
  });

  it('works without a goal or driver', () => {
    expect(dossierBrief(emptyDossier())).toBe('Status: starting.');
  });

  it('cuts the goal first so status and driver survive', () => {
    const brief = dossierBrief({ ...depot, goal: longText(2000) });
    expect(brief.length).toBeLessThanOrEqual(DOSSIER_LIMITS.brief);
    expect(brief.endsWith('Driver: @alice.')).toBe(true);
  });
});
