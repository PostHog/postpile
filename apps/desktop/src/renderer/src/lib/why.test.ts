import { describe, expect, it } from 'vitest';
import { forWhomLabel, personTitle, turnTitle, whyTitle } from './why.ts';

describe('why helpers', () => {
  it('puts for whom into words', () => {
    expect(forWhomLabel({ kind: 'you' })).toBe('For you');
    expect(forWhomLabel({ kind: 'team', team: 'team-platform' })).toBe('For team-platform');
    expect(forWhomLabel({ kind: 'own' })).toBe('Your PR');
    expect(forWhomLabel({ kind: 'none' })).toBe('');
  });

  it('spells the code out, with the layer for pulled-in PRs', () => {
    expect(whyTitle('RT')).toBe('Review asked of your team');
    expect(whyTitle('ST', { kind: 'pulled_in', reason: 'stack layer below #12' })).toBe('Pulled in as stack context: stack layer below #12');
    expect(whyTitle('RV', { kind: 'found', via: 'review_requested', reason: 'review requested from you' })).toBe(
      'Review asked of you (found: review requested from you; not in your inbox, found via GitHub)',
    );
  });

  it('writes turn and person tooltips', () => {
    expect(turnTitle({ kind: 'you', move: 'review', who: null, what: 'Review', prKey: 'a#1' })).toBe('Your move: Review');
    expect(turnTitle({ kind: 'them', who: 'sol', what: 'to merge', prKey: 'a#1' })).toBe('Waiting on sol: sol to merge');
    expect(turnTitle({ kind: 'them', who: 'sol', what: 'and 1 more', prKey: 'a#1', lead: 'Waiting on' })).toBe('Waiting on sol and 1 more');
    expect(turnTitle({ kind: 'them', who: 'acme/team-platform', what: '', prKey: 'a#1', lead: 'Waiting on' })).toBe('Waiting on acme/team-platform');
    expect(turnTitle({ kind: 'none', who: null, what: '', prKey: null })).toBe('');
    expect(personTitle('rowan', 'author')).toBe('rowan (author)');
  });
});
