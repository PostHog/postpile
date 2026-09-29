import { describe, expect, it } from 'vitest';
import type { QuietReadView } from '@postpile/core';
import { botLabel, botsText, quietRef } from './quiet.ts';

describe('Handled quietly helpers', () => {
  it('drops the [bot] suffix and joins the names', () => {
    expect(botLabel('trunk-io[bot]')).toBe('trunk-io');
    expect(botLabel('CI')).toBe('CI');
    expect(botsText(['trunk-io[bot]', 'CI'])).toBe('trunk-io, CI');
    expect(botsText([])).toBe('bots');
  });

  it('names the PR as repo#number', () => {
    const item = { repo: 'acme/app', number: 1904 } as QuietReadView;
    expect(quietRef(item)).toBe('acme/app#1904');
  });
});
