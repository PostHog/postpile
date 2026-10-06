import { prPaneView, type FullPr } from '@postpile/core';
import { at, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { Board } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';

/** Nineteen days after the fixture PRs' activity (2026-09-01): within the sync's 30 days, past SETTLED_DAYS. */
const LATER = new Date('2026-09-20T12:00:00Z');
const RECENT = '2026-09-18T12:00:00.000Z';

function mergedPr(number: number, overrides: Partial<FullPr> = {}): FullPr {
  return reviewRequestedPr(number, { state: 'MERGED', mergedAt: at(5), mergedBy: 'alice', ...overrides });
}

/** The inbox moved since the last sync: the next one reads it again. */
function inboxMoved(h: Harness): void {
  h.reader.etag = `${h.reader.etag}+`;
}

/** Synced once, every event seen and every thread read: what stays hot is hot by state or time alone. */
async function syncedAndRead(h: Harness, topicId: string, prs: FullPr[]): Promise<void> {
  topicWithPrs(h, topicId, prs);
  inboxMoved(h);
  await h.engine.sync({ maxAgentCalls: 0 });
  h.store.events.markSeen(prs.flatMap((pr) => h.store.events.listForPr(pr.key).map((event) => event.id)), at(6));
  readThreadsOnGitHub(h, prs);
}

describe('the hot board', () => {
  const old = mergedPr(1);
  const open = reviewRequestedPr(2, { baseRef: 'branch-4' });
  const stackedBelow = mergedPr(4, { mergedAt: at(5), updatedAt: at(5) });
  const recent = mergedPr(5, { updatedAt: RECENT });

  it('loads open, unread and recent PRs with their stacks, and leaves old settled ones cold', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);
    const unread = mergedPr(3);
    topicWithPrs(h, 'billing', [unread]);
    inboxMoved(h);
    await h.engine.sync({ maxAgentCalls: 0 });

    const board = Board.load(h.store, LATER.toISOString());

    expect([...board.prs.keys()].sort()).toEqual([open.key, unread.key, stackedBelow.key, recent.key].sort());
    expect(board.stackKeysOf(old.key)).toEqual([old.key]);
    expect(board.topicIdOf(old.key)).toBe('depot');
    // A cold PR is parsed per call, never kept in the shared cache.
    expect(h.store.prs.getMany([old.key]).get(old.key)).not.toBe(h.store.prs.getMany([old.key]).get(old.key));
    expect(h.store.prs.getMany([open.key]).get(open.key)).toBe(board.prs.get(open.key));
  });

  it('lists a topic by its hot tiles, and opens it whole with the cold ones', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);

    const listed = (await h.engine.listTopics({ allRepos: true })).find((item) => item.topic.id === 'depot');
    const detail = await h.engine.getTopic('depot');

    expect(listed?.totalTiles).toBe(2);
    expect(detail?.tiles.map((view) => view.tile.id).sort()).toEqual([`pr:${old.key}`, `pr:${recent.key}`, `stack:${stackedBelow.key}`].sort());
  });

  it('reads a cold PR for the PR pane, the search and its tile actions', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);

    const detail = await h.engine.getPr(old.key);
    const search = await h.engine.search('#1', { allRepos: true });
    const snoozed = await h.engine.snooze(`pr:${old.key}`, { kind: 'someone_replies' });

    // The pane gets the slim view of the stored PR, not the PR itself.
    expect(detail?.pr).toEqual(prPaneView(h.store.prs.get(old.key)!));
    expect(detail?.topicId).toBe('depot');
    expect(detail?.tileIds).toEqual([`pr:${old.key}`]);
    expect(search.topics).toEqual([{ topicId: 'depot', tileIds: [`pr:${old.key}`], prKeys: [old.key] }]);
    expect(snoozed.ok).toBe(true);
  });

  it('leaves a topic whose PRs all went cold out of the list, retires it, and opens it from the Archive', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);
    const settled = mergedPr(7);
    await syncedAndRead(h, 'billing', [settled]);
    expect((await h.engine.listTopics({ allRepos: true })).map((item) => item.topic.id)).not.toContain('billing');

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('billing')?.status).toBe('retired');
    expect(h.store.topics.get('depot')?.status).toBe('active');
    expect(report.topicsRetired).toBe(1);
    expect((await h.engine.listFinishedTopics()).map((topic) => topic.id)).toEqual(['billing']);
    expect((await h.engine.getTopic('billing'))?.tiles.map((view) => view.tile.id)).toEqual([`pr:${settled.key}`]);
  });

  it('brings a cold PR back as soon as its thread turns unread', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);
    expect(Board.load(h.store, LATER.toISOString()).prs.has(old.key)).toBe(false);

    h.store.notifications.upsertMany([{ ...makeThreadFor(old), unread: true }]);

    expect(Board.load(h.store, LATER.toISOString()).prs.has(old.key)).toBe(true);
  });

  it('counts the kept PRs per tier for the busy inbox card', async () => {
    const h = makeHarness({ now: () => LATER });
    await syncedAndRead(h, 'depot', [old, open, stackedBelow, recent]);

    // The card reuses what the last load picked: the sidebar's refetch loads the board first.
    await h.engine.listTopics({ allRepos: true });
    const view = await h.engine.busyInbox();

    expect(view).toMatchObject({ busy: false, inboxPrs: 3, keptPrs: 3, quietPrs: 0, cap: 1500 });
    expect(view.keptYou + view.keptTeam + view.keptOthers).toBe(3);
  });
});
