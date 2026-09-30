import { describe, expect, it } from 'vitest';
import { assigneeLine } from './assignees.ts';

describe('assigneeLine', () => {
  it('is null when nobody but the author is assigned', () => {
    expect(assigneeLine('alice', [])).toBeNull();
    expect(assigneeLine('alice', ['Alice'])).toBeNull();
  });

  it('names the assignees of a bot’s PR', () => {
    expect(assigneeLine('acme-agent[bot]', ['alice'])).toEqual({
      shown: ['alice'],
      more: 0,
      title: 'Opened by acme-agent[bot], assigned to alice',
    });
  });

  it('leaves the author out and shows two, then "+N"', () => {
    expect(assigneeLine('alice', ['alice', 'bob'])).toMatchObject({ shown: ['bob'], more: 0 });
    expect(assigneeLine('acme-agent[bot]', ['rowan', 'sol', 'nell'])).toEqual({
      shown: ['rowan', 'sol'],
      more: 1,
      title: 'Opened by acme-agent[bot], assigned to rowan, sol and nell',
    });
  });
});
