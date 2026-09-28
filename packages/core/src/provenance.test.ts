import { describe, expect, it } from 'vitest';
import { makeEvent, makePr, makeThreadFor } from './fixtures.ts';
import { isTracked, provenanceFor } from './provenance.ts';

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
    expect(isTracked(before)).toBe(false);
    const after = provenanceFor(null, 'context', [makeEvent({ kind: 'comment' }), makeEvent({ kind: 'mention' })]);
    expect(after).toEqual({ kind: 'pinged', reason: 'mention' });
  });

  it('counts a review request only when it was for the user, and never a bot mention', () => {
    const forSomeoneElse = makeEvent({ kind: 'review_requested', ruleLoudness: 'quiet' });
    expect(isTracked(provenanceFor(null, 'context', [forSomeoneElse]))).toBe(false);
    const forMe = makeEvent({ kind: 'review_requested', ruleLoudness: 'loud' });
    expect(provenanceFor(null, 'context', [forMe])).toEqual({ kind: 'pinged', reason: 'review_requested' });
    const bot = makeEvent({ kind: 'mention', isBot: true });
    expect(isTracked(provenanceFor(null, 'context', [bot]))).toBe(false);
  });
});

describe('found PRs', () => {
  const found = { prKey: 'PostHog/posthog#1', via: 'review_requested' as const, reason: 'review requested from you', foundAt: '2026-09-28T00:00:00.000Z' };

  it('is found without a thread, even with a review request event', () => {
    const request = makeEvent({ kind: 'review_requested', ruleLoudness: 'loud' });
    expect(provenanceFor(null, 'context', [request], found)).toEqual({ kind: 'found', via: 'review_requested', reason: 'review requested from you' });
  });

  it('turns pinged once a notification thread appears', () => {
    const thread = makeThreadFor(makePr({ number: 1 }), { reason: 'review_requested' });
    expect(provenanceFor(thread, 'context', [], found)).toEqual({ kind: 'pinged', reason: 'review_requested' });
  });

  it('counts as tracked, a pulled-in layer does not', () => {
    expect(isTracked({ kind: 'found', via: 'own_open', reason: 'your open PR' })).toBe(true);
    expect(isTracked({ kind: 'pulled_in', reason: 'stack layer below #2' })).toBe(false);
  });
});
