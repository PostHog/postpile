import { describe, expect, it } from 'vitest';
import { assigneeLine } from './assignees.ts';

describe('assigneeLine', () => {
  it('is null when nobody but the author is assigned', () => {
    expect(assigneeLine('alice', [], 'viewer')).toBeNull();
    expect(assigneeLine('alice', ['Alice'], 'viewer')).toBeNull();
  });

  it('names the assignees of a bot’s PR', () => {
    expect(assigneeLine('acme-agent[bot]', ['alice'], 'viewer')).toEqual({
      shown: [{ login: 'alice', name: 'alice' }],
      more: 0,
      title: 'Opened by acme-agent[bot], assigned to alice',
    });
  });

  it('says "you" for the viewer, also on a person’s PR', () => {
    expect(assigneeLine('bob', ['Viewer'], 'viewer')).toEqual({
      shown: [{ login: 'Viewer', name: 'you' }],
      more: 0,
      title: 'Opened by bob, assigned to you',
    });
    expect(assigneeLine('bob', ['viewer'], null)?.shown).toEqual([{ login: 'viewer', name: 'viewer' }]);
  });

  it('leaves the author out and shows two, then "+N"', () => {
    expect(assigneeLine('alice', ['alice', 'bob'], null)).toMatchObject({ shown: [{ login: 'bob' }], more: 0 });
    expect(assigneeLine('acme-agent[bot]', ['rowan', 'sol', 'nell'], null)).toEqual({
      shown: [
        { login: 'rowan', name: 'rowan' },
        { login: 'sol', name: 'sol' },
      ],
      more: 1,
      title: 'Opened by acme-agent[bot], assigned to rowan, sol and nell',
    });
  });
});
