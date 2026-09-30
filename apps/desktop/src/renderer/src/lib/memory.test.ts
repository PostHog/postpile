import { describe, expect, it } from 'vitest';
import type { DossierView } from '@postpile/core';
import { at, makeDossierVersion, makeFact, makeFactRef } from '@postpile/core/fixtures';
import { blockRefs, claimStaleReason, fixedText, leadingPerson, refLabel, sinceLastLooked } from './memory.ts';

function view(overrides: Partial<DossierView> = {}): DossierView {
  return {
    version: 2,
    createdAt: at(0),
    dossier: {
      ...makeDossierVersion().dossier,
      recentChanges: [1, 2, 3, 4].map((minute) => ({ at: at(minute), text: `change ${minute}`, refs: [] })),
    },
    flags: [],
    staleClaims: [],
    changesSinceSeen: null,
    eventsBehind: 0,
    history: [],
    correctedClaims: [],
    fixedClaims: [],
    ...overrides,
  };
}

describe('refLabel', () => {
  it('names the PR and, for comments, reviews and commits, the kind', () => {
    expect(refLabel(makeFactRef({ prKey: 'acme/app#1902' }))).toBe('#1902');
    expect(refLabel(makeFactRef({ kind: 'review', prKey: 'acme/app#1902' }))).toBe('#1902 review');
  });
});

describe('claimStaleReason', () => {
  it('finds the reason for a path', () => {
    const issues = [{ path: 'openQuestions[2]', reason: 'thread_resolved' as const }];
    expect(claimStaleReason('openQuestions[2]', issues)).toBe('thread_resolved');
    expect(claimStaleReason('openQuestions[0]', issues)).toBeNull();
  });
});

describe('sinceLastLooked', () => {
  it('shows the newest few changes when the topic was never marked seen', () => {
    const block = sinceLastLooked(view());
    expect(block.heading).toBe('Recent changes');
    expect(block.changes).toHaveLength(3);
  });

  it('shows the changes after the cursor with counts', () => {
    const block = sinceLastLooked(
      view({
        changesSinceSeen: {
          since: at(2),
          fromVersion: 1,
          changes: [{ at: at(4), text: 'change 4', refs: [] }],
          factsAdded: [makeFact(), makeFact({ id: 'f2' })],
          factsClosed: [],
          newEvents: 1,
        },
      }),
    );
    expect(block.heading).toBe('Since you last looked');
    expect(block.changes.map((change) => change.text)).toEqual(['change 4']);
    expect(block.counts).toEqual([
      { count: 1, words: 'new event' },
      { count: 2, words: 'facts learned' },
    ]);
  });
});

describe('leadingPerson', () => {
  it('splits off a leading login of the topic', () => {
    expect(leadingPerson('lyra asked on #1902', ['rowan', 'lyra'])).toEqual({ login: 'lyra', rest: ' asked on #1902' });
  });

  it('needs the whole word and a known login', () => {
    expect(leadingPerson('lyrae asked', ['lyra'])).toBeNull();
    expect(leadingPerson('#1911 opened', ['lyra'])).toBeNull();
    expect(leadingPerson('lyra', ['lyra'])).toBeNull();
  });
});

describe('fixedText', () => {
  it('returns the newest fix of a line, or null', () => {
    const fixed = view({ fixedClaims: [{ text: 'a', fixed: 'b2' }, { text: 'a', fixed: 'b1' }] });
    expect(fixedText(fixed, 'a')).toBe('b2');
    expect(fixedText(fixed, 'x')).toBeNull();
  });
});

describe('blockRefs', () => {
  const pr = makeFactRef({ prKey: 'acme/app#1902', url: 'https://github.com/acme/app/pull/1902' });
  const review = makeFactRef({ kind: 'review', prKey: 'acme/app#1902', sourceId: 'r1', url: 'https://github.com/acme/app/pull/1902#r1' });
  const other = makeFactRef({ prKey: 'acme/app#1960', url: 'https://github.com/acme/app/pull/1960' });

  it('shows a repeated chip once per block, on its first line', () => {
    expect(blockRefs([{ refs: [pr] }, { refs: [pr, review] }, { refs: [pr, other] }])).toEqual([[pr], [review], [other]]);
  });

  it('drops a repeat inside one line too', () => {
    expect(blockRefs([{ refs: [pr, { ...pr }] }])).toEqual([[pr]]);
  });

  it('keeps chips that look the same but lead elsewhere', () => {
    const elsewhere = { ...pr, url: 'https://github.com/acme/app/pull/1902#event-9' };
    expect(blockRefs([{ refs: [pr] }, { refs: [elsewhere] }])).toEqual([[pr], [elsewhere]]);
  });
});
