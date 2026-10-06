import { describe, expect, it } from 'vitest';
import type { PendingWrite } from './github-writes.ts';
import { pendingWriteStep } from './pending-write.ts';

function write(kind: PendingWrite['kind']): PendingWrite {
  return {
    id: 1,
    kind,
    createdAt: '2026-10-01T09:00:00Z',
    origin: 'tile',
    tileId: 'set:s1',
    batch: 'b1',
    prKeys: [],
    handleKeys: [],
    threads: [
      { id: 't1', updatedAt: '2026-10-01T08:00:00Z', prKey: 'acme/app#1' },
      { id: 't2', updatedAt: '2026-10-01T08:00:00Z', prKey: 'acme/app#2' },
    ],
    readBefore: null,
    catchUp: null,
    error: null,
    triedAt: null,
  };
}

describe('pendingWriteStep on discard', () => {
  it('mutes the PRs of a discarded Unmute again, since GitHub still has them unsubscribed', () => {
    expect(pendingWriteStep(write('subscribe'), { kind: 'discarded' })).toEqual({
      next: { kind: 'gone' },
      effects: [{ kind: 'log_discarded' }, { kind: 'mute_again', prKeys: ['acme/app#1', 'acme/app#2'] }],
    });
  });

  it('only logs a discarded Mute or mark-read', () => {
    for (const kind of ['unsubscribe', 'mark_read'] as const) {
      expect(pendingWriteStep(write(kind), { kind: 'discarded' })).toEqual({ next: { kind: 'gone' }, effects: [{ kind: 'log_discarded' }] });
    }
  });
});
