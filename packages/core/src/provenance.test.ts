import { describe, expect, it } from 'vitest';
import { makeEvent, makePr, makeThreadFor } from './fixtures.ts';
import { isPinged, provenanceFor } from './provenance.ts';

describe('provenanceFor', () => {
  it('is pinged with the thread reason when GitHub notified the user', () => {
    const thread = makeThreadFor(makePr(), { reason: 'author' });
    expect(provenanceFor(thread, 'same area')).toEqual({ kind: 'pinged', reason: 'author' });
  });

  it('is pulled in with the reason when there is no notification', () => {
    expect(provenanceFor(null, 'touches the same workflow')).toEqual({
      kind: 'pulled_in',
      reason: 'touches the same workflow',
    });
  });

  it('upgrades a pulled-in PR to pinged once someone mentions the user', () => {
    const before = provenanceFor(null, 'context', [makeEvent({ kind: 'comment' })]);
    expect(isPinged(before)).toBe(false);
    const after = provenanceFor(null, 'context', [makeEvent({ kind: 'comment' }), makeEvent({ kind: 'mention' })]);
    expect(after).toEqual({ kind: 'pinged', reason: 'mention' });
  });

  it('counts a review request only when it was for the user, and never a bot mention', () => {
    const forSomeoneElse = makeEvent({ kind: 'review_requested', ruleLoudness: 'quiet' });
    expect(isPinged(provenanceFor(null, 'context', [forSomeoneElse]))).toBe(false);
    const forMe = makeEvent({ kind: 'review_requested', ruleLoudness: 'loud' });
    expect(provenanceFor(null, 'context', [forMe])).toEqual({ kind: 'pinged', reason: 'review_requested' });
    const bot = makeEvent({ kind: 'mention', isBot: true });
    expect(isPinged(provenanceFor(null, 'context', [bot]))).toBe(false);
  });
});
