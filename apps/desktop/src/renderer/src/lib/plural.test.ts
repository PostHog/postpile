import { describe, expect, it } from 'vitest';
import { plural } from './plural.ts';

describe('plural', () => {
  it('adds an s except for exactly one', () => {
    expect(plural(0, 'tile')).toBe('0 tiles');
    expect(plural(1, 'tile')).toBe('1 tile');
    expect(plural(2, 'tile')).toBe('2 tiles');
  });

  it('takes an irregular plural', () => {
    expect(plural(1, 'reply', 'replies')).toBe('1 reply');
    expect(plural(3, 'reply', 'replies')).toBe('3 replies');
  });
});
