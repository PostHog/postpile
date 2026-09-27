import { FakeTimers, makePr, makeThreadFor } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { MarkReadQueue } from './mark-read-queue.ts';
import { FakeReader, FakeWriter } from './testing/fakes.ts';

function queueWithTwoThreads() {
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const marked: string[] = [];
  const queue = new MarkReadQueue(writer, reader, new FakeTimers(), 6000, (threadId) => marked.push(threadId));
  const first = makePr({ number: 1 });
  const second = makePr({ number: 2 });
  reader.addPr(first, makeThreadFor(first));
  reader.addPr(second, makeThreadFor(second));
  const threads = [
    { id: 'thread-1', updatedAt: first.updatedAt },
    { id: 'thread-2', updatedAt: second.updatedAt },
  ];
  return { queue, writer, marked, threads, keys: [first.key, second.key] };
}

describe('MarkReadQueue', () => {
  it('keeps sending the rest of a batch after one thread fails and reports it', async () => {
    const { queue, writer, marked, threads, keys } = queueWithTwoThreads();
    writer.failingThreads.add('thread-1');

    queue.enqueue(threads, keys);
    await queue.flush();

    expect(writer.calls).toEqual(['markThreadRead thread-2']);
    expect(marked).toEqual(['thread-2']);
    expect(queue.takeNotes()).toEqual([expect.stringContaining('notification thread-1 failed: boom thread-1')]);
    expect(queue.takeNotes()).toEqual([]);
  });
});
