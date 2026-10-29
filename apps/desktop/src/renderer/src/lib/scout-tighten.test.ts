import { describe, expect, it } from 'vitest';
import type { ScoutTrial } from '@postpile/core';
import {
  checkedVersions,
  currentVersion,
  labelCount,
  labelsForRequest,
  lostWantsText,
  pathsChange,
  promptChange,
  previousVersion,
  pushVersion,
  setLabelWhy,
  tightenBlockedReason,
  tightenedHeading,
  tightenHint,
  toggleLabel,
  undoVersion,
  type ScoutLabels,
} from './scout-tighten.ts';

const TRIAL: ScoutTrial = { days: 2, pulled: 14, examples: [], nearMisses: [], session: 's1', candidates: 31, judged: 31, complete: true, problem: null };

describe('labels', () => {
  it('sets, switches and takes off a label; the same button again takes it off with its note', () => {
    let labels: ScoutLabels = {};
    labels = toggleLabel(labels, 'acme/app#1', 'want');
    labels = setLabelWhy(labels, 'acme/app#1', 'new service');
    labels = toggleLabel(labels, 'acme/app#1', 'noise');
    expect(labels['acme/app#1']).toEqual({ label: 'noise', why: 'new service' });
    labels = toggleLabel(labels, 'acme/app#1', 'noise');
    expect(labels).toEqual({});
  });

  it('takes a note only on a labeled example', () => {
    expect(setLabelWhy({}, 'acme/app#1', 'x')).toEqual({});
  });

  it('sends every label, shown or not, with the note trimmed', () => {
    const labels: ScoutLabels = { 'acme/app#1': { label: 'want', why: ' a service ' }, 'acme/app#2': { label: 'noise', why: '' } };
    expect(labelCount(labels)).toBe(2);
    expect(labelsForRequest(labels)).toEqual([
      { prKey: 'acme/app#1', label: 'want', why: 'a service' },
      { prKey: 'acme/app#2', label: 'noise', why: '' },
    ]);
  });
});

describe('tightenBlockedReason', () => {
  const three: ScoutLabels = { a: { label: 'want', why: '' }, b: { label: 'noise', why: '' }, c: { label: 'noise', why: '' } };

  it('runs once 3 examples are labeled and a dry run is kept', () => {
    expect(tightenBlockedReason({ labels: three, trial: TRIAL, agentOff: null })).toBeNull();
  });

  it('says how many labels are missing, that the dry run is gone, or that the agent is off', () => {
    expect(tightenBlockedReason({ labels: { a: { label: 'want', why: '' } }, trial: TRIAL, agentOff: null })).toBe('Mark 2 more examples Want or Noise first');
    expect(tightenBlockedReason({ labels: three, trial: { ...TRIAL, session: null }, agentOff: null })).toContain('check the scout again');
    expect(tightenBlockedReason({ labels: three, trial: TRIAL, agentOff: 'claude is logged out' })).toBe('claude is logged out');
    expect(tightenHint({})).toContain('(0 of 3)');
  });
});

describe('versions and Undo', () => {
  it('pushes a tightened version and undoes one step back, never past the checked one', () => {
    const checked = checkedVersions('Pull new services.', [], TRIAL);
    const tightened = pushVersion(checked, { prompt: 'Pull new services. Skip tests.', paths: ['+*/'], trial: { ...TRIAL, pulled: 4 }, tightening: { summary: 'Added a skip rule.', droppedHints: 0, lostWants: [] } });

    expect(currentVersion(tightened).prompt).toBe('Pull new services. Skip tests.');
    expect(previousVersion(tightened)?.prompt).toBe('Pull new services.');
    expect(currentVersion(undoVersion(tightened))).toEqual(checked[0]);
    expect(undoVersion(checked)).toBe(checked);
    expect(previousVersion(checked)).toBeNull();
  });
});

describe('words', () => {
  it('heads the result with the count before and after', () => {
    expect(tightenedHeading(TRIAL, { ...TRIAL, pulled: 4 })).toBe('Tightened: 14 → 4 PRs on the last 2 days.');
    expect(tightenedHeading(TRIAL, { ...TRIAL, pulled: 1 })).toBe('Tightened: 14 → 1 PR on the last 2 days.');
  });

  it('names the wanted PRs that were lost', () => {
    expect(lostWantsText([], ['acme/app'])).toBeNull();
    expect(lostWantsText([{ prKey: 'acme/app#2688', title: 'Billing facade', reason: 'no path signal' }], ['acme/app'])).toBe('Lost 1 PR you wanted: #2688 Billing facade');
  });

  it('lists the path hints kept, added and removed', () => {
    expect(pathsChange(['+*/', 'services/**'], ['+*/', 'services/*/api/**'])).toEqual([
      { hint: '+*/', change: 'kept' },
      { hint: 'services/*/api/**', change: 'added' },
      { hint: 'services/**', change: 'removed' },
    ]);
  });
});

describe('promptChange', () => {
  it('shows only the words that changed', () => {
    expect(promptChange('Pull new services. Skip fixes.', 'Pull new services. Skip fixes. Skip test moves.')).toEqual({
      removed: { text: '', cutStart: true, cutEnd: false },
      added: { text: 'Skip test moves.', cutStart: true, cutEnd: false },
    });
    expect(promptChange('Pull new services or facades. Skip fixes.', 'Pull new services. Skip fixes.')).toEqual({
      removed: { text: 'services or facades.', cutStart: true, cutEnd: true },
      added: { text: 'services.', cutStart: true, cutEnd: true },
    });
  });

  it('says nothing changed when only spacing did', () => {
    expect(promptChange('Pull  new services.', 'Pull new services.\n')).toBeNull();
  });
});
