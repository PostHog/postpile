import { describe, expect, it } from 'vitest';
import type { QuietReadView } from '@postpile/core';
import { botLabel, botsText, quietReasonText, quietRef } from './quiet.ts';

describe('Handled quietly helpers', () => {
  it('drops the [bot] suffix and joins the names', () => {
    expect(botLabel('trunk-io[bot]')).toBe('trunk-io');
    expect(botLabel('CI')).toBe('CI');
    expect(botsText(['trunk-io[bot]', 'CI'])).toBe('trunk-io, CI');
    expect(botsText([])).toBe('bots');
  });

  it('says why: the bots, or what the user did', () => {
    expect(quietReasonText({ reason: 'bots', bots: ['trunk-io[bot]', 'CI'] })).toBe('only trunk-io, CI');
    expect(quietReasonText({ reason: 'approved', bots: [] })).toBe('you approved after it');
    expect(quietReasonText({ reason: 'replied', bots: [] })).toBe('you replied after it');
    expect(quietReasonText({ reason: 'opened', bots: [] })).toBe('opened in PostPile');
    expect(quietReasonText({ reason: 'judged', bots: ['lyra', 'CI'] })).toBe('nothing asked of you (lyra, CI)');
    expect(quietReasonText({ reason: 'request_gone', bots: ['alice', 'CI'] })).toBe('request gone, nothing asked of you (alice, CI)');
  });

  it('names the PR as repo#number', () => {
    const item = { repo: 'acme/app', number: 1904 } as QuietReadView;
    expect(quietRef(item)).toBe('acme/app#1904');
  });
});
