import { describe, expect, it } from 'vitest';
import { tailoringLines } from './tailoring.ts';

describe('tailoringLines', () => {
  it('shows one entry per line, blank lines left out', () => {
    expect(tailoringLines('Only cache changes.\n\n From Frontend build: Skip docs. \n')).toEqual(['Only cache changes.', 'From Frontend build: Skip docs.']);
  });
});
