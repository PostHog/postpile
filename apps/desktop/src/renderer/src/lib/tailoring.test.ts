import { describe, expect, it } from 'vitest';
import { TAILORING_HEADER, tailoringLines } from './tailoring.ts';

describe('tailoringLines', () => {
  it('shows one entry per line, blank lines left out', () => {
    expect(tailoringLines('Only cache changes.\n\n From Frontend build: Skip docs. \n')).toEqual(['Only cache changes.', 'From Frontend build: Skip docs.']);
  });
});

describe('TAILORING_HEADER', () => {
  // 2026-10-11: "You told the agent:" claimed words the user never typed (kept lessons, rules, merged lines).
  it('says what the lines are, not who typed them', () => {
    expect(TAILORING_HEADER).toBe('Kept for this topic');
  });
});
