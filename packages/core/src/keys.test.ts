import { describe, expect, it } from 'vitest';
import { isBot, isMachineComment, parsePrKey, prKey } from './index.ts';

describe('prKey', () => {
  it('round-trips through parsePrKey', () => {
    const ref = { repo: 'PostHog/posthog', number: 123 };
    expect(prKey(ref)).toBe('PostHog/posthog#123');
    expect(parsePrKey('PostHog/posthog#123')).toEqual(ref);
  });

  it('rejects malformed keys', () => {
    expect(() => parsePrKey('posthog#1')).toThrow();
    expect(() => parsePrKey('PostHog/posthog#abc')).toThrow();
  });
});

describe('isBot', () => {
  it('flags app accounts and known bots', () => {
    expect(isBot('dependabot[bot]')).toBe(true);
    expect(isBot('github-actions')).toBe(true);
    expect(isBot('viewer')).toBe(false);
  });

  it('flags automation posting as a human', () => {
    expect(isMachineComment({ author: 'someone', body: 'This is an automated review.' })).toBe(true);
  });
});
