import { FakeTimers, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { MarkReadQueue, NO_LOCAL_CHANGE, type ParkedBatch } from './mark-read-queue.ts';
import { FakeReader, FakeWriter, makeWrites } from './testing/fakes.ts';

function queueWithTwoThreads(writesOn = true) {
  const store = Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const writes = makeWrites(store, writer, undefined, writesOn);
  const marked: string[] = [];
  const parked: ParkedBatch[] = [];
  const queue = new MarkReadQueue(
    writes,
    reader,
    new FakeTimers(),
    6000,
    (threadId) => marked.push(threadId),
    (batch) => parked.push(batch),
  );
  const first = makePr({ number: 1 });
  const second = makePr({ number: 2 });
  reader.addPr(first, makeThreadFor(first));
  reader.addPr(second, makeThreadFor(second));
  const threads = [
    { id: 'thread-1', updatedAt: first.updatedAt, prKey: first.key },
    { id: 'thread-2', updatedAt: second.updatedAt, prKey: second.key },
  ];
  const origin = { origin: 'tile' as const, tileId: null };
  const keys = [first.key, second.key];
  const request = { threads, prKeys: keys, handleKeys: keys, local: NO_LOCAL_CHANGE, subscription: null };
  return { store, queue, reader, writer, writes, marked, parked, request, origin };
}

describe('MarkReadQueue', () => {
  it('keeps sending the rest of a batch after one thread fails and reports it', async () => {
    const { store, queue, writer, marked, request, origin } = queueWithTwoThreads();
    writer.failingThreads.add('thread-1');

    const batch = queue.enqueue(request, origin);
    await queue.flush();

    expect(writer.calls).toEqual(['markThreadRead thread-2']);
    expect(marked).toEqual(['thread-2']);
    expect(queue.takeNotes()).toEqual([expect.stringContaining("GitHub didn't take it: boom thread-1; still unread")]);
    expect(queue.takeNotes()).toEqual([]);
    const log = store.actionLog.listRecent(10).map((entry) => [entry.threadId, entry.origin, entry.outcome, entry.batch]);
    expect(log).toEqual([
      ['thread-2', 'quit', 'github', batch.batchId],
      ['thread-1', 'quit', 'failed', batch.batchId],
    ]);
  });

  it('parks a batch queued while locked, even when writes come on inside the undo window', async () => {
    const { queue, writer, writes, marked, parked, request, origin } = queueWithTwoThreads(false);

    const batch = queue.enqueue(request, origin);
    writes.set(true);
    await queue.flush();

    expect(batch.writesOn).toBe(false);
    expect(writer.calls).toEqual([]);
    expect(marked).toEqual([]);
    expect(parked).toEqual([expect.objectContaining({ batchId: batch.batchId, threads: request.threads, handleKeys: request.handleKeys })]);
  });

  it('parks instead of sending when writes are locked inside the undo window', async () => {
    const { store, queue, writer, writes, parked, request, origin } = queueWithTwoThreads();

    queue.enqueue(request, origin);
    writes.set(false);
    await queue.flush();

    expect(writer.calls).toEqual([]);
    expect(parked).toHaveLength(1);
    expect(store.actionLog.listRecent(10).filter((entry) => entry.action === 'mark_read')).toEqual([]);
  });

  it('parks the threads the lock stopped mid-send instead of dropping them to unread', async () => {
    const { queue, reader, writer, writes, marked, parked, request, origin } = queueWithTwoThreads();
    const getThread = reader.getThread.bind(reader);
    reader.getThread = async (id) => {
      if (id === 'thread-2') {
        writes.set(false);
      }
      return getThread(id);
    };

    const batch = queue.enqueue(request, origin);
    await queue.flush();

    expect(writer.calls).toEqual(['markThreadRead thread-1']);
    expect(marked).toEqual(['thread-1']);
    expect(parked).toEqual([
      expect.objectContaining({ batchId: batch.batchId, threads: [request.threads[1]], prKeys: [request.prKeys[1]], handleKeys: [request.prKeys[1]] }),
    ]);
    expect(queue.takeNotes()).toEqual([]);
  });

  it('parks nothing for a batch without threads', async () => {
    const { queue, writes, parked, request, origin } = queueWithTwoThreads(false);
    queue.enqueue({ ...request, threads: [] }, origin);
    writes.set(false);
    await queue.flush();
    expect(parked).toEqual([]);
  });
});
