import { describe, expect, it } from 'vitest';
import { mentionsUser } from './mentions.ts';

describe('mentionsUser', () => {
  it('matches the whole login, any case, followed by anything that is not part of a login', () => {
    expect(mentionsUser('thanks @Bob, merged', 'bob')).toBe(true);
    expect(mentionsUser('@bob', 'bob')).toBe(true);
    expect(mentionsUser('ask @bob.', 'bob')).toBe(true);
  });

  it('does not take a longer login for a mention', () => {
    expect(mentionsUser('@bob-helper confirmed this', 'bob')).toBe(false);
    expect(mentionsUser('@bobby said so', 'bob')).toBe(false);
    expect(mentionsUser('@bob2 said so', 'bob')).toBe(false);
  });
});
