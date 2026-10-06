import { describe, expect, it } from 'vitest';
import { APPROVE_OPENERS, approveNoteBody, nextApproveOpener, reviewNoteIntent } from './review-note.ts';

describe('nextApproveOpener', () => {
  it('starts with the first opener', () => {
    expect(nextApproveOpener(null)).toBe('Looks good.');
  });

  it('never picks the last one again and wraps around the list', () => {
    for (const opener of APPROVE_OPENERS) {
      expect(nextApproveOpener(opener)).not.toBe(opener);
    }
    expect(nextApproveOpener(APPROVE_OPENERS.at(-1) ?? null)).toBe(APPROVE_OPENERS[0]);
  });

  it('starts over when the stored opener left the list', () => {
    expect(nextApproveOpener('Ship it.')).toBe('Looks good.');
  });
});

describe('approveNoteBody', () => {
  it('is the opener alone without a point', () => {
    expect(approveNoteBody('LGTM.', '  ')).toBe('LGTM.');
  });

  it('puts the one point after the opener', () => {
    expect(approveNoteBody('Good to go.', 'Watch the cron after deploy.\n')).toBe('Good to go. Watch the cron after deploy.');
  });
});

describe('reviewNoteIntent', () => {
  it('keeps the approve note to an optional point in plain words, no nitpicks, no checklist', () => {
    const intent = reviewNoteIntent('approve');
    expect(intent).toContain('never an opener');
    expect(intent).toContain('at most one short sentence');
    expect(intent).toContain('never list what was checked');
    expect(intent).toContain('No nitpicks');
    expect(intent).toContain('without having read the diff');
  });

  it('keeps the comment review to one point worth a look, in plain words', () => {
    const intent = reviewNoteIntent('comment');
    expect(intent).toContain('the one point most worth a look');
    expect(intent).toContain('No nitpicks');
    expect(intent).not.toContain('opener');
  });
});
