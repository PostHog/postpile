import { describe, expect, it } from 'vitest';
import { at } from '@postpile/core/fixtures';
import { ageLabel, newest, sinceLabel, whenLabel } from './time.ts';

describe('time helpers', () => {
  const now = new Date(at(0));

  it('says since when: the clock today, else the day', () => {
    const today = new Date(at(-30));
    expect(sinceLabel(at(-30), now)).toBe(`${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`);
    expect(sinceLabel(at(-3 * 24 * 60), now)).toBe(new Date(at(-3 * 24 * 60)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    expect(sinceLabel('not a time', now)).toBe('');
  });

  it('formats short ages', () => {
    expect(ageLabel(at(0), now)).toBe('now');
    expect(ageLabel(at(-20), now)).toBe('20m');
    expect(ageLabel(at(-5 * 60), now)).toBe('5h');
    expect(ageLabel(at(-3 * 24 * 60), now)).toBe('3d');
    expect(ageLabel(at(-15 * 24 * 60), now)).toBe('2w');
  });

  it('finds the newest time', () => {
    expect(newest([at(1), at(3), at(2)])).toBe(at(3));
    expect(newest([])).toBeNull();
  });

  it('says when for running text, in calendar days', () => {
    expect(whenLabel(at(0), now)).toBe('just now');
    expect(whenLabel(at(-20), now)).toBe('20m ago');
    expect(whenLabel(at(-24 * 60), now)).toBe('yesterday');
    expect(whenLabel(at(-3 * 24 * 60), now)).toBe('3 days ago');
    expect(whenLabel(at(-15 * 24 * 60), now)).toBe('2w ago');
    expect(whenLabel('not a time', now)).toBe('');
  });
});
