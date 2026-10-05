// Storage job 2 (DESIGN.md "CI is not tracked"): removes the checks older
// builds stored in the snapshot json, one snapshot per unit, without moving
// a revision or changing a read, and is done only when the data says so.
import { at, FakeTimers, makePr } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, NOW } from '../testing/fakes.ts';
import { CHECKS_STRIP_SINCE_KEY, ChecksStripJob } from './checks-strip.ts';
import { storageJobs } from './jobs.ts';
import { PAUSE_MS, START_DELAY_MS, StorageJobRunner, type StorageJobReport } from './runner.ts';

const OLD_CHECKS = { rollup: 'SUCCESS', contexts: [{ name: 'lint', conclusion: 'SUCCESS', completedAt: '2026-09-01T09:05:00.000Z' }] };

/** The PR as a build before 0.21.0 stored it: its checks in the json. */
function storedWithChecks(store: Store, number: number): string {
  const pr = makePr({ number });
  store.prs.upsert(pr, at(1));
  store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.checks', json(?)) WHERE key = ?").run(JSON.stringify(OLD_CHECKS), pr.key);
  return pr.key;
}

function withChecks(store: Store): string[] {
  return (store.db.prepare("SELECT key FROM pr_snapshot WHERE json_type(json, '$.checks') IS NOT NULL ORDER BY key").all() as { key: string }[]).map((row) => row.key);
}

function revisions(store: Store): unknown[] {
  return store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
}

describe('the checks_strip job', () => {
  let store: Store;
  let reports: StorageJobReport[];
  let lines: string[];

  beforeEach(() => {
    store = Store.open(':memory:');
    reports = [];
    lines = [];
  });

  afterEach(() => {
    store.close();
  });

  function runner(): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs: [new ChecksStripJob()],
      now: () => NOW,
      timers: new FakeTimers(),
      busy: () => false,
      log: (line) => lines.push(line),
      onDone: (report) => reports.push(report),
      sliceBudgetMs: 0,
    });
  }

  it('removes the checks from every stored snapshot, without a new revision or a different read', () => {
    storedWithChecks(store, 1);
    storedWithChecks(store, 2);
    store.prs.upsert(makePr({ number: 3 }), at(1));
    const before = store.prs.listAll();
    const revisionsBefore = revisions(store);
    const jobs = runner();

    for (let index = 0; index < 10 && jobs.slice() !== 'idle'; index += 1) {
      // One snapshot per slice.
    }

    expect(withChecks(store)).toEqual([]);
    expect(store.prs.listAll()).toEqual(before);
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(store.meta.get(new ChecksStripJob().doneKey)).toBe(NOW.toISOString());
    expect(store.meta.get(CHECKS_STRIP_SINCE_KEY)).toBeNull();
    // Three snapshots walked, two of them rewritten.
    expect(reports).toMatchObject([{ name: 'checks_strip', units: 3, wrote: 2 }]);
  });

  it('walks again when a snapshot with checks was written behind its cursor, and is done only once none is left', () => {
    storedWithChecks(store, 1);
    storedWithChecks(store, 3);
    const jobs = runner();
    expect(jobs.slice()).toBe('worked');
    expect(jobs.slice()).toBe('worked');
    // Something wrote old-style json behind the cursor meanwhile (this build never does): a newer revision.
    storedWithChecks(store, 2);

    for (let index = 0; index < 20 && jobs.slice() !== 'idle'; index += 1) {
      // On to the end, the check, the second walk.
    }

    expect(lines[0]).toMatch(/checks_strip: its check failed at the end, walking it once more/);
    expect(withChecks(store)).toEqual([]);
    expect(store.meta.get(new ChecksStripJob().doneKey)).not.toBeNull();
  });

  it('is not held up by snapshots this build wrote while it walked', () => {
    storedWithChecks(store, 1);
    storedWithChecks(store, 3);
    const jobs = runner();
    expect(jobs.slice()).toBe('worked');
    expect(jobs.slice()).toBe('worked');
    // A fetch behind the cursor: this build writes no checks.
    store.prs.upsert(makePr({ number: 2, title: 'fetched again' }), at(5));

    for (let index = 0; index < 10 && jobs.slice() !== 'idle'; index += 1) {
      // On to the end.
    }

    expect(lines).toEqual([expect.stringMatching(/^storage job checks_strip done:/)]);
    expect(withChecks(store)).toEqual([]);
  });

  it('runs after the bot body trim', () => {
    expect(storageJobs().map((job) => job.name)).toEqual(['bot_body_trim', 'checks_strip']);
  });
});

describe('Engine.startStorageJobs with the checks strip', () => {
  it('runs the trim, then the strip, on the engine timers and reports each', async () => {
    const h = makeHarness();
    storedWithChecks(h.store, 1);

    h.engine.startStorageJobs();
    h.timers.advance(START_DELAY_MS);
    for (let index = 0; index < 100 && h.store.meta.get(new ChecksStripJob().doneKey) === null; index += 1) {
      h.timers.advance(PAUSE_MS);
    }

    expect(withChecks(h.store)).toEqual([]);
    const done = h.telemetry.events.filter((event) => event.event === 'storage_job_done').map((event) => (event.props as { name: string }).name);
    expect(done).toEqual(['bot_body_trim', 'checks_strip']);
    await h.engine.close();
  });
});
