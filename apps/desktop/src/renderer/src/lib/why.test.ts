import { describe, expect, it } from 'vitest';
import { personTitle, turnTitle, WHY, whyTitle } from './why.ts';

describe('why helpers', () => {
  it('tints codes aimed at you, your team, yours, passive and context', () => {
    expect([WHY.RV.tone, WHY['@'].tone, WHY.AS.tone]).toEqual(['you', 'you', 'you']);
    expect([WHY.RT.tone, WHY['@T'].tone]).toEqual(['team', 'team']);
    expect([WHY.AU.tone, WHY.CM.tone, WHY.FW.tone, WHY.ST.tone]).toEqual(['own', 'passive', 'passive', 'context']);
  });

  it('spells the code out, with the layer for pulled-in PRs', () => {
    expect(whyTitle('RT')).toBe('Review asked of your team');
    expect(whyTitle('ST', { kind: 'pulled_in', reason: 'stack layer below #12' })).toBe('Pulled in as stack context: stack layer below #12');
  });

  it('writes turn and person tooltips', () => {
    expect(turnTitle({ kind: 'you', who: null, what: 'Review', prKey: 'a#1' })).toBe('Your move: Review');
    expect(turnTitle({ kind: 'them', who: 'sol', what: 'to merge', prKey: 'a#1' })).toBe('Waiting on sol: sol to merge');
    expect(turnTitle({ kind: 'none', who: null, what: '', prKey: null })).toBe('');
    expect(personTitle('rowan', 'author')).toBe('rowan (author)');
  });
});
