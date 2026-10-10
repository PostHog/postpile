import { describe, expect, it } from 'vitest';
import { untilText } from './notes-text.ts';

describe('untilText', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  it('names the unit of every part', () => {
    expect(untilText(inMinutes(179.5), now)).toBe('2 h 59 min');
    expect(untilText(inMinutes(120), now)).toBe('2 h');
    expect(untilText(inMinutes(45), now)).toBe('45 min');
    expect(untilText(inMinutes(0.5), now)).toBe('under a minute');
  });
});
