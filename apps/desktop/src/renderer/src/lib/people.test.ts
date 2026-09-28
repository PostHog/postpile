import { describe, expect, it } from 'vitest';
import { avatarUrl, initials } from './people.ts';

describe('avatarUrl', () => {
  it('points at GitHub avatars for users', () => {
    expect(avatarUrl('rowan', 44, true)).toBe('https://avatars.githubusercontent.com/rowan?s=44');
  });

  it('has none for bots, teams and empty logins', () => {
    expect(avatarUrl('renovate[bot]', 36, true)).toBeNull();
    expect(avatarUrl('acme/team-platform', 36, true)).toBeNull();
    expect(avatarUrl('', 36, true)).toBeNull();
  });

  it('has none without remote avatars, so sample logins stay initials', () => {
    expect(avatarUrl('rowan', 44, false)).toBeNull();
  });
});

describe('initials', () => {
  it('takes two letters of the name', () => {
    expect(initials('renovate[bot]')).toBe('RE');
    expect(initials('acme/team-platform')).toBe('TE');
  });
});
