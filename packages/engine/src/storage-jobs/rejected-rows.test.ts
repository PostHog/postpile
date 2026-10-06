// A PR whose stored json a row backfill rejects (DESIGN.md "PR storage"):
// the job switches without it, the PR then counts as not stored, the next
// sync fetches it again and its upsert writes every row. A PR GitHub no
// longer has stays left out and never holds a switch back (Codex review on
// #140).
import { canonicalPr } from '@postpile/core';
import { ACTIVITY_READY_KEY, DISCUSSION_READY_KEY, NEWEST_ROWS_VERSION, ROWS, TEXT_READY_KEY } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { topicWithPrs } from '../testing/topics.ts';
import { storageJobs } from './jobs.ts';
import { StorageJobRunner, type StorageJobBlocked } from './runner.ts';

/** A synced PR put back the way 0.22.0 left it (discussion rows, json for the rest, no later switch), its files list broken. */
async function syncedWithBrokenJson(): Promise<{ h: Harness; key: string; setNow: (iso: string) => void }> {
  let now = new Date('2026-09-02T12:00:00Z');
  const h = makeHarness({ now: () => now });
  const pr = reviewRequestedPr(1);
  topicWithPrs(h, 'depot', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  const full = h.store.prs.getFull(pr.key)!;
  h.store.db.prepare('UPDATE pr_snapshot SET json = ? WHERE key = ?').run(JSON.stringify({ ...full, comments: [], threads: [], reviews: [], files: 'broken' }), pr.key);
  h.store.db.prepare('UPDATE pr SET rows_version = ? WHERE key = ?').run(ROWS.discussion, pr.key);
  for (const table of ['pr_commit', 'pr_timeline', 'pr_file', 'pr_body']) {
    h.store.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(pr.key);
  }
  for (const job of storageJobs().slice(0, 4)) {
    h.store.meta.set(job.doneKey, now.toISOString());
  }
  h.store.meta.set(DISCUSSION_READY_KEY, now.toISOString());
  return { h, key: pr.key, setNow: (iso: string) => (now = new Date(iso)) };
}

function runJobs(h: Harness, blocked: StorageJobBlocked[]): void {
  const runner = new StorageJobRunner({
    store: h.store,
    jobs: storageJobs(),
    now: () => new Date('2026-09-02T12:01:00Z'),
    timers: h.timers,
    busy: () => false,
    log: () => {},
    onDone: () => {},
    onBlocked: (job) => blocked.push(job),
    sliceBudgetMs: 0,
  });
  for (let index = 0; index < 50 && runner.slice() !== 'idle'; index += 1) {
    // Every job, a slice at a time.
  }
}

describe('a PR a row backfill rejects', () => {
  it('is reported stale, the next sync fetches it again, and the switches all happen', async () => {
    const { h, key, setNow } = await syncedWithBrokenJson();
    const blocked: StorageJobBlocked[] = [];

    runJobs(h, blocked);

    expect([ACTIVITY_READY_KEY, TEXT_READY_KEY].map((flag) => h.store.meta.get(flag) !== null)).toEqual([true, true]);
    expect(h.store.prs.hasSnapshotTable()).toBe(false);
    expect(blocked).toEqual([
      { name: 'activity_rows', blockedUnits: 1 },
      { name: 'text_rows', blockedUnits: 1 },
    ]);
    expect(h.store.prs.get(key)).toBeNull();
    expect(h.store.prs.fetchedAtByKey().has(key)).toBe(false);
    expect(h.store.prs.updatedAtByKey().has(key)).toBe(false);

    setNow('2026-09-02T12:10:00Z');
    const fetches = h.reader.fetchedRefs.length;
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.reader.fetchedRefs.slice(fetches).flat().map((ref) => `${ref.repo}#${ref.number}`)).toContain(key);
    expect(h.store.db.prepare('SELECT rows_version FROM pr WHERE key = ?').get(key)).toEqual({ rows_version: NEWEST_ROWS_VERSION });
    expect(h.store.prs.getFull(key)).toEqual(canonicalPr(h.reader.prs.get(key)!));
    await h.engine.close();
  });

  it('never holds the switch back when GitHub no longer has it', async () => {
    const { h, key, setNow } = await syncedWithBrokenJson();
    // Lost access, deleted repo: GitHub answers without it.
    h.reader.prs.delete(key);
    h.reader.threads = [];

    runJobs(h, []);
    setNow('2026-09-02T12:10:00Z');
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.meta.get(TEXT_READY_KEY)).not.toBeNull();
    expect(h.store.prs.hasSnapshotTable()).toBe(false);
    expect(h.store.prs.get(key)).toBeNull();
    expect(h.store.prs.keys()).toContain(key);
    await h.engine.close();
  });
});
