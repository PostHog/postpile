import { describe, expect, it } from 'vitest';
import { CatchUpQueue } from './catch-up-queue.ts';

/** A run the test ends by hand. */
interface HeldRun {
  topicId: string | null;
  finish: () => void;
}

function heldQueue(canStart: () => boolean = () => true): { queue: CatchUpQueue; runs: HeldRun[] } {
  const runs: HeldRun[] = [];
  const queue = new CatchUpQueue(
    (topicId) =>
      new Promise<void>((resolve) => {
        runs.push({ topicId, finish: resolve });
      }),
    canStart,
    () => {},
  );
  return { queue, runs };
}

/** Lets the finally of a finished run happen. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('CatchUpQueue', () => {
  it('runs a burst for one topic as one run plus exactly one follow-up', async () => {
    const { queue, runs } = heldQueue();

    expect(queue.request('depot')).toBe('started');
    for (let i = 0; i < 5; i += 1) {
      expect(queue.request('depot')).toBe('queued');
    }
    expect(runs).toHaveLength(1);
    expect(queue.stateOf('depot')).toBe('running');

    runs[0]!.finish();
    await settle();
    // The one follow-up started; nothing else is waiting.
    expect(runs).toHaveLength(2);
    expect(queue.stateOf('depot')).toBe('running');

    runs[1]!.finish();
    await settle();
    expect(runs).toHaveLength(2);
    expect(queue.stateOf('depot')).toBeNull();
  });

  it('runs different topics side by side, Unsorted apart from real topics', async () => {
    const { queue, runs } = heldQueue();

    queue.request('depot');
    queue.request('billing');
    queue.request(null);

    expect(runs.map((run) => run.topicId)).toEqual(['depot', 'billing', null]);
    expect(queue.stateOf(null)).toBe('running');
  });

  it('skips requests while it may not start, and drops the follow-up when a sync takes over', async () => {
    let syncing = false;
    const { queue, runs } = heldQueue(() => !syncing);

    queue.request('depot');
    queue.request('depot');
    expect(queue.stateOf('depot')).toBe('running');
    syncing = true;
    queue.dropQueued();
    expect(queue.request('billing')).toBe('skipped');

    const settled = queue.settled();
    runs[0]!.finish();
    await settled;
    await settle();
    expect(runs).toHaveLength(1);
    expect(queue.stateOf('depot')).toBeNull();
  });

  it('counts every queue, start and end, so the renderer knows when to refetch', async () => {
    const { queue, runs } = heldQueue();
    const before = queue.changes();

    queue.request('depot');
    queue.request('depot');
    queue.request('depot');
    expect(queue.changes()).toBe(before + 2);
    runs[0]!.finish();
    await settle();
    expect(queue.changes()).toBe(before + 4);
  });

  it('logs a failed run and still starts the follow-up', async () => {
    const lines: string[] = [];
    let calls = 0;
    const queue = new CatchUpQueue(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('boom');
        }
      },
      () => true,
      (line) => lines.push(line),
    );

    queue.request('depot');
    queue.request('depot');
    await settle();
    await settle();

    expect(calls).toBe(2);
    expect(lines).toEqual(['catch-up depot: failed: boom']);
  });
});
