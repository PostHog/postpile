import { describe, expect, it } from 'vitest';
import { isBot, isMachineComment, parsePrKey, prKey } from './index.ts';

describe('prKey', () => {
  it('round-trips through parsePrKey', () => {
    const ref = { repo: 'acme/app', number: 123 };
    expect(prKey(ref)).toBe('acme/app#123');
    expect(parsePrKey('acme/app#123')).toEqual(ref);
  });

  it('rejects malformed keys', () => {
    expect(() => parsePrKey('app#1')).toThrow();
    expect(() => parsePrKey('acme/app#abc')).toThrow();
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
