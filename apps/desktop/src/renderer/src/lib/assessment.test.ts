import { describe, expect, it } from 'vitest';
import type { Glance } from '@postpile/core';
import { assessment, sentences, splitRisk } from './assessment.ts';

const glance: Glance = {
  prKey: 'o/r#1',
  verdict: 'LOOK_CLOSER',
  forYou: 'Shared export pipeline change, squarely devex territory. Check the retry cap is set before it lands.',
  does: 'Moves the retry wrapper into the export job runner.',
  risk: 'medium - A retry loop with no cap could spin forever.',
  othersSaid: 'sol asked for a rollback note; no approvals yet.',
  keyFiles: [],
  pullInReason: null,
  dossierVersion: null,
  inputHash: 'h',
  model: 'sonnet',
  createdAt: '2026-09-27T10:00:00.000Z',
};

describe('sentences', () => {
  it('splits on sentence ends only', () => {
    expect(sentences('Bumps turbo to v2.5 in ci.yml. Nothing else changes.')).toEqual(['Bumps turbo to v2.5 in ci.yml.', 'Nothing else changes.']);
    expect(sentences('  ')).toEqual([]);
  });
});

describe('splitRisk', () => {
  it('reads the level off the front', () => {
    expect(splitRisk('medium - cold runs')).toEqual({ level: 'medium', rest: 'cold runs' });
    expect(splitRisk('High: breaks deploys')).toEqual({ level: 'high', rest: 'breaks deploys' });
    expect(splitRisk('unclear')).toEqual({ level: '', rest: 'unclear' });
  });
});

describe('assessment', () => {
  it('titles box 1 with the verdict and marks the main point and the check', () => {
    const view = assessment(glance, { kind: 'you' });
    expect(view.title).toBe('LOOK CLOSER');
    expect(view.tag).toBe('· for you');
    expect(view.lines).toEqual([
      { mark: '!', text: 'Shared export pipeline change, squarely devex territory.' },
      { mark: '?', text: 'Check the retry cap is set before it lands.' },
    ]);
  });

  it('puts the risk level only in the risk box title and never adds a CI line of its own', () => {
    const view = assessment(glance, { kind: 'you' });
    expect(view.risk).toEqual({
      level: 'medium',
      unchecked: '',
      lines: [{ mark: '▲', text: 'A retry loop with no cap could spin forever.' }],
    });
  });

  it('leaves the risk box out without risk content', () => {
    expect(assessment({ ...glance, risk: '' }, null).risk).toBeNull();
  });

  it('leaves the risk box out for a low risk, keeps it for medium, high and unlabeled ones', () => {
    expect(assessment({ ...glance, risk: 'low - CI green.' }, null).risk).toBeNull();
    expect(assessment({ ...glance, risk: 'Low alone.' }, null).risk).toBeNull();
    expect(assessment({ ...glance, risk: 'High. Drops a table.' }, null).risk?.level).toBe('high');
    expect(assessment({ ...glance, risk: 'Jobs could share cache entries.' }, null).risk).toEqual({
      level: '',
      unchecked: '',
      lines: [{ mark: '▲', text: 'Jobs could share cache entries.' }],
    });
  });

  it('caps each box at three lines', () => {
    const long = 'One. Two. Three. Four. Five.';
    expect(assessment({ ...glance, forYou: long }, null).lines).toHaveLength(3);
    expect(assessment({ ...glance, risk: `high - ${long}` }, null).risk?.lines).toHaveLength(3);
  });

  it('tags by for whom, and never on not-yours', () => {
    expect(assessment(glance, { kind: 'team', team: 'team-platform' }).tag).toBe('· for team-platform');
    expect(assessment(glance, { kind: 'own' }).tag).toBe('· your PR');
    expect(assessment(glance, { kind: 'none' }).tag).toBe('');
    expect(assessment({ ...glance, verdict: 'NOT_YOURS' }, { kind: 'you' })).toMatchObject({ title: 'NOT YOURS', tag: '' });
  });

  it('notes only the claims the agent did not check, nothing on older glances', () => {
    const basis = { risk: { checked: false, note: 'inferred from the description' }, verdict: { checked: true, note: 'changed files' } };
    const view = assessment({ ...glance, basis }, null);
    expect(view.unchecked).toBe('');
    expect(view.risk?.unchecked).toBe('· not checked: inferred from the description');
    const verdictOnly = assessment({ ...glance, basis: { risk: null, verdict: { checked: false, note: '' } } }, null);
    expect(verdictOnly.unchecked).toBe('· not checked');
    expect(verdictOnly.risk?.unchecked).toBe('');
    expect(assessment(glance, null)).toMatchObject({ unchecked: '', risk: { unchecked: '' } });
  });
});
