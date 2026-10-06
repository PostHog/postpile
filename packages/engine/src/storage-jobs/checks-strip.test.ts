// Storage job 2 (DESIGN.md "CI is not tracked"): removes the checks older
// builds stored in the snapshot json, one snapshot per unit, without moving
// a revision or changing a read, and is done only after a whole walk found
// none left.
import { at, FakeTimers, makePr } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, NOW } from '../testing/fakes.ts';
import { CHECKS_STRIP_STRIPPED_KEY, ChecksStripJob } from './checks-strip.ts';
import { storageJobs } from './jobs.ts';
import { PAUSE_MS, START_DELAY_MS, StorageJobRunner, type StorageJobReport } from './runner.ts';

const OLD_CHECKS = { rollup: 'SUCCESS', contexts: [{ name: 'lint', conclusion: 'SUCCESS', completedAt: '2026-09-01T09:05:00.000Z' }] };

/** The PR as a build before 0.21.0 stored it: its checks in the json. */
function storedWithChecks(store: Store, number: number): string {
  const pr = makePr({ number });
  store.prs.upsert(pr, at(1));
  addChecks(store, pr.key);
  return pr.key;
}

/** Checks put back into a stored json the way an older build writes them, its revision kept. */
function addChecks(store: Store, key: string): void {
  store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.checks', json(?)) WHERE key = ?").run(JSON.stringify(OLD_CHECKS), key);
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

  function runToEnd(jobs: StorageJobRunner): void {
    for (let index = 0; index < 30 && jobs.slice() !== 'idle'; index += 1) {
      // One snapshot per slice.
    }
  }

  it('removes the checks from every stored snapshot, without a new revision or a different read, then walks once more to verify', () => {
    storedWithChecks(store, 1);
    storedWithChecks(store, 2);
    store.prs.upsert(makePr({ number: 3 }), at(1));
    const before = store.prs.listAll();
    const revisionsBefore = revisions(store);

    runToEnd(runner());

    expect(withChecks(store)).toEqual([]);
    expect(store.prs.listAll()).toEqual(before);
    expect(revisions(store)).toEqual(revisionsBefore);
    expect(store.meta.get(new ChecksStripJob().doneKey)).toBe(NOW.toISOString());
    expect(store.meta.get(CHECKS_STRIP_STRIPPED_KEY)).toBeNull();
    // Two walks over three snapshots: the first rewrote two, the second found nothing.
    expect(reports).toMatchObject([{ name: 'checks_strip', units: 6, wrote: 2 }]);
    expect(lines).toEqual([expect.stringMatching(/^storage job checks_strip done:/)]);
  });

  it('is done after one walk when nothing held checks', () => {
    store.prs.upsert(makePr({ number: 1 }), at(1));
    store.prs.upsert(makePr({ number: 2 }), at(1));

    runToEnd(runner());

    expect(reports).toMatchObject([{ units: 2, wrote: 0 }]);
  });

  it('catches checks an older build wrote back behind the cursor with its revision kept', () => {
    storedWithChecks(store, 1);
    storedWithChecks(store, 3);
    const jobs = runner();
    expect(jobs.slice()).toBe('worked');
    expect(jobs.slice()).toBe('worked');
    // An unguarded 0.19.0 rewrote #1 meanwhile: checks back, revision as it was.
    const revision = revisions(store);
    addChecks(store, 'acme/app#1');
    expect(revisions(store)).toEqual(revision);

    runToEnd(jobs);

    expect(withChecks(store)).toEqual([]);
    expect(store.meta.get(new ChecksStripJob().doneKey)).not.toBeNull();
  });

  it('keeps walking while snapshots come back with checks, and is not done before a clean walk', () => {
    storedWithChecks(store, 1);
    const jobs = runner();
    expect(jobs.slice()).toBe('worked');
    // The first walk ends here and the verifying walk starts at #1; an older build writes it back each time.
    addChecks(store, 'acme/app#1');
    expect(jobs.slice()).toBe('worked');
    expect(store.meta.get(new ChecksStripJob().doneKey)).toBeNull();
    expect(store.meta.get(CHECKS_STRIP_STRIPPED_KEY)).toBe('1');

    runToEnd(jobs);

    expect(withChecks(store)).toEqual([]);
    expect(store.meta.get(new ChecksStripJob().doneKey)).not.toBeNull();
  });

  it('runs after the bot body trim, before the discussion rows', () => {
    expect(storageJobs().map((job) => job.name)).toEqual(['bot_body_trim', 'checks_strip', 'discussion_rows', 'snapshot_strip', 'activity_rows', 'snapshot_strip_2', 'text_rows', 'snapshot_retire']);
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
