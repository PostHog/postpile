import { describe, expect, it } from 'vitest';
import { at } from '@code-manager/core/fixtures';
import { ageLabel, newest } from './time.ts';

describe('time helpers', () => {
  const now = new Date(at(0));

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
});
