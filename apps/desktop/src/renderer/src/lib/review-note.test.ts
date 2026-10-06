import { describe, expect, it } from 'vitest';
import { reviewNoteSource } from './review-note.ts';

describe('reviewNoteSource', () => {
  it('is own when the agent never drafted', () => {
    expect(reviewNoteSource('Looks good.', null)).toBe('own');
  });

  it('is agent when the draft went out as drafted, trailing whitespace aside', () => {
    expect(reviewNoteSource('Looks good.\n', 'Looks good.')).toBe('agent');
  });

  it('is agent_edited when the user changed the draft', () => {
    expect(reviewNoteSource('Looks good, ship it.', 'Looks good.')).toBe('agent_edited');
  });
});
