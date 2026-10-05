import { describe, expect, it } from 'vitest';
import { CatchUpQueue, MAX_RUNNING_CATCH_UPS } from './catch-up-queue.ts';

/** A run the test ends by hand. */
interface HeldRun {
  topicId: string | null;
  /** Null for a whole-topic run. */
  prKeys: string[] | null;
  finish: () => void;
}

function heldQueue(canStart: () => boolean = () => true): { queue: CatchUpQueue; runs: HeldRun[] } {
  const runs: HeldRun[] = [];
  const held = (topicId: string | null, prKeys: string[] | null) =>
    new Promise<void>((resolve) => {
      runs.push({ topicId, prKeys, finish: resolve });
    });
  const queue = new CatchUpQueue({ topic: (topicId) => held(topicId, null), glances: (topicId, prKeys) => held(topicId, prKeys) }, canStart, () => {});
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
    queue.request(null);

    expect(runs.map((run) => run.topicId)).toEqual(['depot', null]);
    expect(queue.stateOf(null)).toBe('running');
  });

  it('runs at most two topics at once; the others wait their turn, first come first served', async () => {
    const { queue, runs } = heldQueue();
    expect(MAX_RUNNING_CATCH_UPS).toBe(2);

    expect(queue.request('depot')).toBe('started');
    expect(queue.request('billing')).toBe('started');
    expect(queue.request('ingest')).toBe('queued');
    expect(queue.requestGlance('replay', 'acme/app#7')).toBe('queued');
    expect(queue.requestGlance('replay', 'acme/app#8')).toBe('queued');
    expect(queue.request('ingest')).toBe('queued');
    expect(queue.stateOf('ingest')).toBe('queued');
    // A follow-up for a running topic goes to the back of the line.
    expect(queue.request('depot')).toBe('queued');
    expect(runs).toHaveLength(2);

    runs[0]!.finish();
    await settle();
    expect(runs.map((run) => run.topicId)).toEqual(['depot', 'billing', 'ingest']);
    runs[1]!.finish();
    await settle();
    expect(runs[3]).toMatchObject({ topicId: 'replay', prKeys: ['acme/app#7', 'acme/app#8'] });
    runs[2]!.finish();
    await settle();
    expect(runs.map((run) => run.topicId)).toEqual(['depot', 'billing', 'ingest', 'replay', 'depot']);
  });

  it('drops the waiting line when a sync takes over', async () => {
    let syncing = false;
    const { queue, runs } = heldQueue(() => !syncing);

    queue.request('depot');
    queue.request('billing');
    queue.request('ingest');
    syncing = true;
    queue.dropQueued();
    runs[0]!.finish();
    await settle();
    expect(runs).toHaveLength(2);
    expect(queue.stateOf('ingest')).toBeNull();
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
      {
        topic: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('boom');
          }
        },
        glances: async () => {},
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

  it("runs one PR's glance alone, and folds it into a queued topic run", async () => {
    const { queue, runs } = heldQueue();

    expect(queue.requestGlance('depot', 'acme/app#1')).toBe('started');
    expect(queue.stateOf('depot', 'acme/app#1')).toBe('running');
    // Another PR of the topic is not being written, and the topic's memory is not either.
    expect(queue.stateOf('depot', 'acme/app#2')).toBeNull();
    expect(queue.stateOf('depot')).toBeNull();
    expect(queue.requestGlance('depot', 'acme/app#2')).toBe('queued');
    expect(queue.requestGlance('depot', 'acme/app#2')).toBe('covered');
    expect(queue.stateOf('depot', 'acme/app#2')).toBe('queued');
    // A whole-topic follow-up covers the queued glance and every later one.
    expect(queue.request('depot')).toBe('queued');
    expect(queue.requestGlance('depot', 'acme/app#3')).toBe('covered');

    runs[0]!.finish();
    await settle();
    expect(runs.map((run) => run.prKeys)).toEqual([['acme/app#1'], null]);
  });

  it('queues a glance behind a topic run already going: that run may have read the PR before it changed', async () => {
    const { queue, runs } = heldQueue();
    queue.request('depot');

    expect(queue.requestGlance('depot', 'acme/app#1')).toBe('queued');
    expect(queue.requestGlance('depot', 'acme/app#1')).toBe('covered');

    runs[0]!.finish();
    await settle();
    expect(runs.map((run) => run.prKeys)).toEqual([null, ['acme/app#1']]);
  });
});
