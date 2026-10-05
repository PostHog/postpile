// The storage job runner (DESIGN.md "Storage jobs") over small test jobs
// that tag rows of a scratch table: slices and pauses, waits, sleep, a
// write lock held elsewhere, fail-closed completion, rollback and resume.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StorageJobName } from '@postpile/core';
import { at, FakeTimers, makePr } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../testing/fakes.ts';
import {
  INCOMPLETE_KEY_PREFIX,
  PAUSE_MS,
  RETRY_MS,
  StorageJobRunner,
  WAKE_DELAY_MS,
  type StorageJob,
  type StorageJobReport,
  type StorageJobUnit,
} from './runner.ts';

/** FakeTimers whose clock also moves while a unit works, so a slice can spend its budget. */
class WorkClock extends FakeTimers {
  private worked = 0;

  override now(): number {
    return super.now() + this.worked;
  }

  work(ms: number): void {
    this.worked += ms;
  }
}

/** Test jobs carry names the telemetry catalogue does not know; the runner only passes them on. */
function jobName(name: string): StorageJobName {
  return name as StorageJobName;
}

/** Appends its name to the value of each `job_item` row, one row per unit. */
class TagJob implements StorageJob {
  readonly name: StorageJobName;
  readonly cursorKey: string;
  readonly doneKey: string;
  /** What complete() answers, in turn; 'done' once empty. */
  checks: Array<'done' | 'again'> = [];
  /** A unit on this key throws after writing. */
  failOn: string | null = null;

  constructor(
    name: string,
    private readonly clock: WorkClock,
    private readonly unitMs = 0,
  ) {
    this.name = jobName(name);
    this.cursorKey = `test_job:${name}:after`;
    this.doneKey = `test_job:${name}:done`;
  }

  step(store: Store, after: string): StorageJobUnit | null {
    const row = store.db.prepare('SELECT key, value FROM job_item WHERE key > ? ORDER BY key LIMIT 1').get(after) as { key: string; value: string } | undefined;
    if (row === undefined) {
      return null;
    }
    store.db.prepare('UPDATE job_item SET value = ? WHERE key = ?').run(`${row.value}+${this.name}`, row.key);
    if (row.key === this.failOn) {
      throw new Error(`unit ${row.key} failed`);
    }
    this.clock.work(this.unitMs);
    return { key: row.key, wrote: true };
  }

  complete(): 'done' | 'again' {
    return this.checks.shift() ?? 'done';
  }
}

function addItems(store: Store, keys: string[]): void {
  store.db.exec('CREATE TABLE IF NOT EXISTS job_item (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const key of keys) {
    store.db.prepare('INSERT INTO job_item (key, value) VALUES (?, ?)').run(key, key);
  }
}

function items(store: Store): string[] {
  return (store.db.prepare('SELECT value FROM job_item ORDER BY key').all() as { value: string }[]).map((row) => row.value);
}

describe('StorageJobRunner', () => {
  let store: Store;
  let clock: WorkClock;
  let busy: boolean;
  let lines: string[];
  let reports: StorageJobReport[];
  const dirs: string[] = [];

  beforeEach(() => {
    store = Store.open(':memory:');
    clock = new WorkClock();
    busy = false;
    lines = [];
    reports = [];
  });

  afterEach(() => {
    if (store.db.isOpen) {
      store.close();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function runnerFor(jobs: StorageJob[], sliceBudgetMs?: number): StorageJobRunner {
    return new StorageJobRunner({
      store,
      jobs,
      now: () => NOW,
      timers: clock,
      busy: () => busy,
      log: (line) => lines.push(line),
      onDone: (report) => reports.push(report),
      sliceBudgetMs,
    });
  }

  function tempDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'postpile-jobs-'));
    dirs.push(dir);
    return join(dir, 'db.sqlite');
  }

  /** Every unit's tag, how many times: each item done exactly once reads one tag per item. */
  function tagCount(name: string): number {
    return items(store).join('').split(`+${name}`).length - 1;
  }

  it('runs units until the 30 ms budget is spent, then rests 50 ms between slices', () => {
    addItems(store, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const job = new TagJob('tag', clock, 10);
    runnerFor([job]).start(0);

    clock.advance(0);
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c+tag', 'd', 'e', 'f', 'g', 'h']);
    expect(store.meta.get(job.cursorKey)).toBe('c');

    clock.advance(PAUSE_MS - 1);
    expect(store.meta.get(job.cursorKey)).toBe('c');
    clock.advance(1);
    expect(store.meta.get(job.cursorKey)).toBe('f');

    clock.advance(PAUSE_MS);
    expect(items(store).every((value) => value.endsWith('+tag'))).toBe(true);
    expect(store.meta.get(job.doneKey)).toBe(NOW.toISOString());
    expect(store.meta.get(job.cursorKey)).toBeNull();
    // Slices of 30, 30 and 20 ms of work; from the first slice to the end 180 ms, the two pauses included.
    expect(reports).toEqual([{ name: 'tag', units: 8, wrote: 8, workMs: 80, longestSliceMs: 30, wallMs: 180 }]);
    expect(lines).toEqual(['storage job tag done: 8 of 8 units rewritten, work 80 ms, longest slice 30 ms, wall 180 ms']);
  });

  it('runs one unit per slice when a unit alone takes longer than the budget', () => {
    addItems(store, ['a', 'b', 'c']);
    const job = new TagJob('tag', clock, 100);
    runnerFor([job]).start(0);

    clock.advance(0);
    expect(items(store)).toEqual(['a+tag', 'b', 'c']);
    clock.advance(PAUSE_MS);
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c']);
  });

  it('starts no slice while foreground work runs, and looks again every 2 s', () => {
    addItems(store, ['a', 'b']);
    busy = true;
    runnerFor([new TagJob('tag', clock)], 0).start(0);

    clock.advance(0);
    clock.advance(RETRY_MS * 5);
    expect(items(store)).toEqual(['a', 'b']);

    busy = false;
    clock.advance(RETRY_MS - 1);
    expect(items(store)).toEqual(['a', 'b']);
    clock.advance(1);
    expect(items(store)).toEqual(['a+tag', 'b']);
  });

  it('stops while the Mac sleeps and goes on 30 s after the wake', () => {
    addItems(store, ['a', 'b', 'c']);
    const runner = runnerFor([new TagJob('tag', clock)], 0);
    runner.start(0);
    clock.advance(0);
    expect(items(store)).toEqual(['a+tag', 'b', 'c']);

    runner.suspend();
    clock.advance(10 * 60_000);
    expect(items(store)).toEqual(['a+tag', 'b', 'c']);

    runner.resume();
    runner.resume();
    clock.advance(WAKE_DELAY_MS - 1);
    expect(items(store)).toEqual(['a+tag', 'b', 'c']);
    clock.advance(1);
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c']);
  });

  it('waits for the wake when the Mac sleeps before the start delay ends, and a wake alone starts nothing', () => {
    addItems(store, ['a']);
    const idle = runnerFor([new TagJob('tag', clock)], 0);
    idle.resume();
    clock.advance(WAKE_DELAY_MS);
    expect(items(store)).toEqual(['a']);

    const runner = runnerFor([new TagJob('tag', clock)], 0);
    runner.start(1_000);
    runner.suspend();
    clock.advance(60_000);
    expect(items(store)).toEqual(['a']);
    runner.resume();
    clock.advance(WAKE_DELAY_MS);
    expect(items(store)).toEqual(['a+tag']);
  });

  it('does not wait for a write lock another connection holds: it tries again 2 s later', () => {
    const path = tempDb();
    store.close();
    store = Store.open(path);
    addItems(store, ['a', 'b']);
    const job = new TagJob('tag', clock);
    const runner = runnerFor([job], 0);
    const other = new DatabaseSync(path);
    other.exec('BEGIN IMMEDIATE');

    const started = Date.now();
    expect(runner.slice()).toBe('locked');
    runner.start(0);
    clock.advance(0);
    // The 5 s busy timeout would have held the main thread here.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(items(store)).toEqual(['a', 'b']);
    expect(store.meta.get(job.cursorKey)).toBeNull();
    expect(store.db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });

    other.exec('ROLLBACK');
    other.close();
    clock.advance(RETRY_MS);
    expect(items(store)).toEqual(['a+tag', 'b']);
    expect(lines).toEqual([]);
  });

  it('marks a job done only when its check passes, after one more walk at most', () => {
    addItems(store, ['a', 'b']);
    const job = new TagJob('tag', clock);
    job.checks = ['again', 'done'];
    const runner = runnerFor([job]);

    expect(runner.slice()).toBe('worked');
    expect(store.meta.get(job.doneKey)).toBeNull();
    expect(lines).toEqual(['storage job tag: its check failed at the end, walking it once more']);
    expect(runner.slice()).toBe('worked');
    expect(items(store)).toEqual(['a+tag+tag', 'b+tag+tag']);
    expect(store.meta.get(job.doneKey)).toBe(NOW.toISOString());
    expect(reports).toMatchObject([{ name: 'tag', units: 4 }]);
  });

  it('leaves a job whose check fails twice incomplete: never done, the jobs after it wait, the next start tries again', () => {
    addItems(store, ['a', 'b']);
    const first = new TagJob('first', clock);
    first.checks = ['again', 'again'];
    const second = new TagJob('second', clock);
    const runner = runnerFor([first, second], 0);

    runner.start(0);
    clock.advance(0);
    for (let index = 0; index < 20; index += 1) {
      clock.advance(PAUSE_MS);
    }

    expect(items(store)).toEqual(['a+first+first', 'b+first+first']);
    expect(store.meta.get(first.doneKey)).toBeNull();
    expect(store.meta.get(first.cursorKey)).toBeNull();
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}first`)).toBe(NOW.toISOString());
    expect(store.meta.get(second.doneKey)).toBeNull();
    expect(reports).toEqual([]);
    expect(lines.at(-1)).toMatch(/^storage job first is incomplete: its check failed again after a second walk/);
    clock.advance(10 * RETRY_MS);
    expect(items(store)).toEqual(['a+first+first', 'b+first+first']);

    // The next start: the check passes now.
    const again = new TagJob('first', clock);
    runnerFor([again, second], 0).start(0);
    clock.advance(0);
    for (let index = 0; index < 20; index += 1) {
      clock.advance(PAUSE_MS);
    }
    expect(store.meta.get(again.doneKey)).not.toBeNull();
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}first`)).toBeNull();
    expect(items(store)).toEqual(['a+first+first+first+second', 'b+first+first+first+second']);
  });

  it('gives an incomplete job its one more walk again when the same runner starts again, and counts only that run', () => {
    addItems(store, ['a', 'b']);
    const job = new TagJob('tag', clock);
    job.checks = ['again', 'again', 'again', 'done'];
    const runner = runnerFor([job], 0);
    runner.start(0);
    for (let index = 0; index < 20; index += 1) {
      clock.advance(PAUSE_MS);
    }
    expect(store.meta.get(`${INCOMPLETE_KEY_PREFIX}tag`)).not.toBeNull();

    runner.start(0);
    for (let index = 0; index < 20; index += 1) {
      clock.advance(PAUSE_MS);
    }
    expect(items(store)).toEqual(['a+tag+tag+tag+tag', 'b+tag+tag+tag+tag']);
    expect(store.meta.get(job.doneKey)).not.toBeNull();
    expect(reports).toMatchObject([{ name: 'tag', units: 4 }]);
  });

  it('rolls a failing slice back whole and stops; the next start goes on after the last slice that committed', () => {
    addItems(store, ['a', 'b', 'c', 'd', 'e', 'f']);
    const job = new TagJob('tag', clock, 10);
    job.failOn = 'e';
    runnerFor([job]).start(0);

    clock.advance(0);
    clock.advance(PAUSE_MS);
    clock.advance(10 * RETRY_MS);
    // d was written in the failing slice, before e threw: rolled back with it.
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c+tag', 'd', 'e', 'f']);
    expect(store.meta.get(job.cursorKey)).toBe('c');
    expect(lines).toEqual(['storage job tag failed, the next start goes on after its last slice: unit e failed']);

    job.failOn = null;
    runnerFor([job]).start(0);
    clock.advance(0);
    clock.advance(PAUSE_MS);
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c+tag', 'd+tag', 'e+tag', 'f+tag']);
    expect(store.meta.get(job.doneKey)).not.toBeNull();
  });

  it('resumes from the cursor in the file after the app died mid-job, doing no unit twice', () => {
    const path = tempDb();
    store.close();
    store = Store.open(path);
    addItems(store, ['a', 'b', 'c', 'd']);
    const job = new TagJob('tag', clock);
    const runner = runnerFor([job], 0);
    runner.slice();
    runner.slice();
    // No stop(), no clean close of the engine: the process is gone after the commits.
    store.close();

    store = Store.open(path);
    expect(store.meta.get(job.cursorKey)).toBe('b');
    runnerFor([job], 0).start(0);
    clock.advance(0);
    for (let index = 0; index < 5; index += 1) {
      clock.advance(PAUSE_MS);
    }
    expect(items(store)).toEqual(['a+tag', 'b+tag', 'c+tag', 'd+tag']);
    expect(store.meta.get(job.doneKey)).not.toBeNull();
    expect(reports).toMatchObject([{ units: 2 }]);
  });

  it('lets a job write rows of its own beside the PRs and switch on readiness, moving no PR revision', () => {
    for (const number of [1, 2, 3]) {
      store.prs.upsert(makePr({ number }), at(1));
    }
    const revisions = (): unknown[] => store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
    const before = revisions();
    const counter = store.meta.get('snapshot_revision');
    store.db.exec('CREATE TABLE pr_side (pr_key TEXT PRIMARY KEY, title TEXT NOT NULL)');
    // Like a backfill: copies into rows no read uses yet, then sets its flag only once every PR has them.
    const backfill: StorageJob = {
      name: jobName('side'),
      cursorKey: 'test_job:side:after',
      doneKey: 'test_job:side:done',
      step(jobStore, after) {
        const row = jobStore.db.prepare('SELECT key, title FROM pr WHERE key > ? ORDER BY key LIMIT 1').get(after) as { key: string; title: string } | undefined;
        if (row === undefined) {
          return null;
        }
        jobStore.db.prepare('INSERT INTO pr_side (pr_key, title) VALUES (?, ?)').run(row.key, row.title);
        return { key: row.key, wrote: true };
      },
      complete(jobStore) {
        const missing = jobStore.db.prepare('SELECT count(*) AS n FROM pr WHERE key NOT IN (SELECT pr_key FROM pr_side)').get() as { n: number };
        if (missing.n > 0) {
          return 'again';
        }
        jobStore.meta.set('test_ready:side', '1');
        return 'done';
      },
    };

    runnerFor([backfill], 0).start(0);
    for (let index = 0; index < 10; index += 1) {
      clock.advance(PAUSE_MS);
    }

    expect(store.db.prepare('SELECT count(*) AS n FROM pr_side').get()).toEqual({ n: 3 });
    expect(store.meta.get('test_ready:side')).toBe('1');
    expect(store.meta.get(backfill.doneKey)).not.toBeNull();
    expect(revisions()).toEqual(before);
    expect(store.meta.get('snapshot_revision')).toBe(counter);
  });

  it('runs every job in order on an install that skipped releases, each once the one before is done', () => {
    addItems(store, ['a', 'b']);
    const jobs = [new TagJob('one', clock), new TagJob('two', clock), new TagJob('three', clock)];
    runnerFor(jobs, 0).start(0);

    clock.advance(0);
    clock.advance(PAUSE_MS);
    expect(items(store)).toEqual(['a+one', 'b+one']);
    expect(store.meta.get(jobs[0]!.doneKey)).toBeNull();
    for (let index = 0; index < 20; index += 1) {
      clock.advance(PAUSE_MS);
    }

    expect(items(store)).toEqual(['a+one+two+three', 'b+one+two+three']);
    expect(jobs.every((job) => store.meta.get(job.doneKey) !== null)).toBe(true);
    expect(reports.map((report) => report.name)).toEqual(['one', 'two', 'three']);
    expect(tagCount('two')).toBe(2);
  });

  it('starts at the first job not done, so a job an earlier release finished does not run again', () => {
    addItems(store, ['a']);
    const jobs = [new TagJob('one', clock), new TagJob('two', clock)];
    store.meta.set(jobs[0]!.doneKey, '2026-10-01T00:00:00.000Z');
    const runner = runnerFor(jobs, 0);

    runner.start(0);
    for (let index = 0; index < 10; index += 1) {
      clock.advance(PAUSE_MS);
    }
    expect(items(store)).toEqual(['a+two']);
    expect(runner.slice()).toBe('idle');

    runner.start(0);
    clock.advance(PAUSE_MS);
    expect(lines).toHaveLength(1);
  });
});
