import { describe, expect, it } from 'vitest';
import type { DossierView } from '@code-manager/core';
import { at, makeDossierVersion } from '@code-manager/core/fixtures';
import { changePath, checkLabel, targetKey, targetQuery } from './sources.ts';

describe('checkLabel', () => {
  it('says whether a line still holds', () => {
    expect(checkLabel({ state: 'ok', reason: null, note: null })).toEqual({ text: 'Checks out against GitHub', tone: 'ok' });
    expect(checkLabel({ state: 'stale', reason: 'head_moved', note: null })).toEqual({ text: 'Stale: PR moved since', tone: 'warn' });
    expect(checkLabel({ state: 'closed', reason: null, note: 'the user said it is wrong' }).text).toBe('No longer believed: the user said it is wrong');
    expect(checkLabel({ state: 'unsourced', reason: null, note: null }).text).toBe('No source recorded');
  });
});

describe('targets', () => {
  it('builds keys and query strings', () => {
    const line = { kind: 'dossier_line' as const, topicId: 'topic-depot', version: 3, path: 'openQuestions[0]' };
    expect(targetKey(line)).toBe('line:topic-depot:3:openQuestions[0]');
    expect(targetQuery(line)).toBe('topic=topic-depot&version=3&path=openQuestions%5B0%5D');
    expect(targetQuery({ kind: 'fact', factId: 'f 1' })).toBe('fact=f+1');
  });

  it('finds a shown change in the full list', () => {
    const changes = [
      { at: at(2), text: 'b', refs: [] },
      { at: at(1), text: 'a', refs: [] },
    ];
    const view = { version: 1, dossier: { ...makeDossierVersion().dossier, recentChanges: changes } } as unknown as DossierView;
    expect(changePath(view, { at: at(1), text: 'a' })).toBe('recentChanges[1]');
    expect(changePath(view, { at: at(9), text: 'x' })).toBeNull();
  });
});
