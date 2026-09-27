import { describe, expect, it } from 'vitest';
import { DeferredQueue, UNDO_WINDOW_MS } from './deferred-queue.ts';
import { FakeTimers } from './fixtures.ts';

function setup() {
  const timers = new FakeTimers();
  const sent: string[][] = [];
  const queue = new DeferredQueue<string[]>(async (ids) => {
    sent.push(ids);
  }, timers);
  return { timers, sent, queue };
}

describe('DeferredQueue', () => {
  it('sends a batch only after the undo window', async () => {
    const { timers, sent, queue } = setup();
    const batch = queue.enqueue(['t1']);
    expect(batch.dueAt).toBe(1000 + UNDO_WINDOW_MS);
    timers.advance(UNDO_WINDOW_MS - 1);
    expect(sent).toEqual([]);
    timers.advance(1);
    await Promise.resolve();
    expect(sent).toEqual([['t1']]);
    expect(queue.pending()).toEqual([]);
  });

  it('undo inside the window cancels the send', () => {
    const { timers, sent, queue } = setup();
    const batch = queue.enqueue(['t1']);
    expect(queue.undo(batch.token)?.payload).toEqual(['t1']);
    timers.advance(UNDO_WINDOW_MS * 2);
    expect(sent).toEqual([]);
  });

  it('undo without a token walks back newest first', () => {
    const { queue } = setup();
    queue.enqueue(['a']);
    queue.enqueue(['b']);
    expect(queue.undo(null)?.payload).toEqual(['b']);
    expect(queue.undo(null)?.payload).toEqual(['a']);
    expect(queue.undo(null)).toBeNull();
  });

  it('returns null when undoing something already sent', async () => {
    const { timers, queue } = setup();
    const batch = queue.enqueue(['a']);
    timers.advance(UNDO_WINDOW_MS);
    await Promise.resolve();
    expect(queue.undo(batch.token)).toBeNull();
  });

  it('flush sends everything now, oldest first, and nothing twice', async () => {
    const { timers, sent, queue } = setup();
    queue.enqueue(['a']);
    queue.enqueue(['b']);
    await queue.flush();
    expect(sent).toEqual([['a'], ['b']]);
    timers.advance(UNDO_WINDOW_MS);
    await Promise.resolve();
    expect(sent).toHaveLength(2);
  });

  it('reports send failures instead of throwing from a timer', async () => {
    const timers = new FakeTimers();
    const failures: string[] = [];
    const queue = new DeferredQueue<string>(
      async () => {
        throw new Error('boom');
      },
      timers,
      10,
      (error, batch) => failures.push(`${batch.payload}: ${(error as Error).message}`),
    );
    queue.enqueue('t1');
    timers.advance(10);
    await new Promise((resolve) => setImmediate(resolve));
    expect(failures).toEqual(['t1: boom']);
  });
});
