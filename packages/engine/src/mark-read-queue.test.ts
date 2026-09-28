import { FakeTimers, makePr, makeThreadFor } from '@code-manager/core/fixtures';
import { Store } from '@code-manager/store';
import { describe, expect, it } from 'vitest';
import { MarkReadQueue } from './mark-read-queue.ts';
import { FakeReader, FakeWriter, makeWrites } from './testing/fakes.ts';

function queueWithTwoThreads(writesOn = true) {
  const store = Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const writes = makeWrites(store, writer, undefined, writesOn);
  const marked: string[] = [];
  const queue = new MarkReadQueue(writes, reader, new FakeTimers(), 6000, (threadId) => marked.push(threadId));
  const first = makePr({ number: 1 });
  const second = makePr({ number: 2 });
  reader.addPr(first, makeThreadFor(first));
  reader.addPr(second, makeThreadFor(second));
  const threads = [
    { id: 'thread-1', updatedAt: first.updatedAt, prKey: first.key },
    { id: 'thread-2', updatedAt: second.updatedAt, prKey: second.key },
  ];
  const origin = { origin: 'tile' as const, tileId: null };
  return { store, queue, writer, writes, marked, threads, origin, keys: [first.key, second.key] };
}

describe('MarkReadQueue', () => {
  it('keeps sending the rest of a batch after one thread fails and reports it', async () => {
    const { store, queue, writer, marked, threads, keys, origin } = queueWithTwoThreads();
    writer.failingThreads.add('thread-1');

    const batch = queue.enqueue(threads, keys, origin);
    await queue.flush();

    expect(writer.calls).toEqual(['markThreadRead thread-2']);
    expect(marked).toEqual(['thread-2']);
    expect(queue.takeNotes()).toEqual([expect.stringContaining('notification thread-1 failed: boom thread-1')]);
    expect(queue.takeNotes()).toEqual([]);
    const log = store.actionLog.listRecent(10).map((entry) => [entry.threadId, entry.origin, entry.outcome, entry.batch]);
    expect(log).toEqual([
      ['thread-2', 'quit', 'github', batch.batchId],
      ['thread-1', 'quit', 'failed', batch.batchId],
    ]);
  });

  it('keeps a batch queued while read-only local, even when writes come on inside the undo window', async () => {
    const { queue, writer, writes, marked, threads, keys, origin } = queueWithTwoThreads(false);

    const batch = queue.enqueue(threads, keys, origin);
    writes.set(true);
    await queue.flush();

    expect(batch.writesOn).toBe(false);
    expect(writer.calls).toEqual([]);
    expect(marked).toEqual([]);
  });

  it('sends nothing when writes are turned off inside the undo window, and logs it as local', async () => {
    const { store, queue, writer, writes, threads, keys, origin } = queueWithTwoThreads();

    queue.enqueue(threads, keys, origin);
    writes.set(false);
    await queue.flush();

    expect(writer.calls).toEqual([]);
    const sends = store.actionLog.listRecent(10).filter((entry) => entry.action === 'mark_read');
    expect(sends.map((entry) => entry.outcome)).toEqual(['local', 'local']);
  });
});
