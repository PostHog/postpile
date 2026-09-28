import { describe, expect, it } from 'vitest';
import { markReadNote, writeBlockedReason } from './guard.ts';

const OFF = { enabled: false, forcedOffReason: null, pending: [] };
const ON = { enabled: true, forcedOffReason: null, pending: [] };
const FORCED = { enabled: false, forcedOffReason: 'POSTPILE_READ_ONLY=1 forces read-only.', pending: [] };

describe('writeBlockedReason', () => {
  it('blocks approve and comment while GitHub writes are off', () => {
    expect(writeBlockedReason('approve', OFF)).toMatch(/Open the lock in the footer/);
    expect(writeBlockedReason('comment', FORCED)).toMatch(/POSTPILE_READ_ONLY=1/);
    expect(writeBlockedReason('approve', ON)).toBeNull();
  });

  it('lets mark-reads run while locked, they become pending writes', () => {
    expect(writeBlockedReason('markRead', OFF)).toBeNull();
    expect(writeBlockedReason('notMine', FORCED)).toBeNull();
    expect(markReadNote(OFF)).toMatch(/pending write/);
    expect(markReadNote(ON)).toBeUndefined();
  });

  it('blocks while the writes state is still loading', () => {
    expect(writeBlockedReason('markRead', undefined)).toMatch(/until the app knows/);
  });
});
