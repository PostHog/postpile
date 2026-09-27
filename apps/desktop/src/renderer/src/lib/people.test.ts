import { describe, expect, it } from 'vitest';
import { avatarUrl, initials } from './people.ts';

describe('avatarUrl', () => {
  it('points at GitHub avatars for users', () => {
    expect(avatarUrl('rowan', 44)).toBe('https://avatars.githubusercontent.com/rowan?s=44');
  });

  it('has none for bots, teams and empty logins', () => {
    expect(avatarUrl('renovate[bot]', 36)).toBeNull();
    expect(avatarUrl('PostHog/team-devex', 36)).toBeNull();
    expect(avatarUrl('', 36)).toBeNull();
  });
});

describe('initials', () => {
  it('takes two letters of the name', () => {
    expect(initials('renovate[bot]')).toBe('RE');
    expect(initials('PostHog/team-devex')).toBe('TE');
  });
});
