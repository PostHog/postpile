import { describe, expect, it } from 'vitest';
import { claimBasisText, parseClaimBasis } from './glance-basis.ts';

describe('parseClaimBasis', () => {
  it('reads checked with what it was checked against', () => {
    expect(parseClaimBasis('checked: changed files')).toEqual({ checked: true, note: 'changed files' });
    expect(parseClaimBasis('Checked')).toEqual({ checked: true, note: '' });
    expect(parseClaimBasis('checked - review by @alice')).toEqual({ checked: true, note: 'review by @alice' });
  });

  it('reads not checked with the reason', () => {
    expect(parseClaimBasis('not checked: inferred from the description')).toEqual({ checked: false, note: 'inferred from the description' });
    expect(parseClaimBasis('Not checked')).toEqual({ checked: false, note: '' });
    expect(parseClaimBasis('unchecked: files list capped')).toEqual({ checked: false, note: 'files list capped' });
  });

  it('is null for anything else, so a garbled answer never reads as checked', () => {
    expect(parseClaimBasis(undefined)).toBeNull();
    expect(parseClaimBasis(null)).toBeNull();
    expect(parseClaimBasis(true)).toBeNull();
    expect(parseClaimBasis('')).toBeNull();
    expect(parseClaimBasis('mostly checked')).toBeNull();
    expect(parseClaimBasis('checkedness unknown')).toBeNull();
  });

  it('cuts a long note', () => {
    const basis = parseClaimBasis(`not checked: ${'word '.repeat(40)}`);
    expect(basis?.note.length).toBeLessThanOrEqual(80);
    expect(basis?.note.endsWith('…')).toBe(true);
  });
});

describe('claimBasisText', () => {
  it('says the word and the note', () => {
    expect(claimBasisText({ checked: true, note: 'changed files' })).toBe('checked: changed files');
    expect(claimBasisText({ checked: false, note: 'inferred from the description' })).toBe('not checked: inferred from the description');
    expect(claimBasisText({ checked: false, note: '' })).toBe('not checked');
  });
});
