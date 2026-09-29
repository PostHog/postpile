import { at, makeTimelineItem } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const AGENT = { source: 'agent', client: 'claude-code' } as const;

async function trackedPr() {
  let now = new Date('2026-09-02T12:00:00Z');
  const h = makeHarness({ now: () => now });
  const pr = reviewRequestedPr(1);
  topicWithPrs(h, 'depot', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  return { h, pr, setNow: (iso: string) => (now = new Date(iso)) };
}

describe('refreshNow from an outside agent', () => {
  it('fetches the PR in one poll cycle, says it came back with news and logs it without a thread', async () => {
    const { h, pr, setNow } = await trackedPr();
    setNow('2026-09-02T12:05:00Z');
    // Merged on GitHub; no new notification for it.
    h.reader.addStackPr({ ...pr, state: 'MERGED', updatedAt: at(20), timeline: [...pr.timeline, makeTimelineItem({ id: 'm1', kind: 'merged', actor: 'rowan', at: at(20), subject: null })] });

    const result = await h.engine.refreshNow({ kind: 'pr', prKey: pr.key }, AGENT);

    expect(result).toMatchObject({ status: 'done', fetched: [pr.key], changed: [pr.key], joinedSync: false });
    expect(h.reader.fetchedRefs.at(-1)).toEqual([pr.ref]);
    expect(h.store.prs.get(pr.key)?.state).toBe('MERGED');
    const [entry] = await h.engine.actionLog(1);
    expect(entry).toMatchObject({ action: 'agent_refresh', origin: 'agent', outcome: 'github', prKey: null, threadId: null });
    expect(entry?.detail).toBe(`claude-code: 1 PRs, 1 fetched, 1 with news, 0 fresh (${pr.key})`);
  });

  it('skips a PR fetched a moment ago', async () => {
    const { h, pr, setNow } = await trackedPr();
    setNow('2026-09-02T12:00:30Z');
    const fetches = h.reader.fetchedRefs.length;
    const result = await h.engine.refreshNow({ kind: 'pr', prKey: pr.key }, AGENT);
    expect(result).toMatchObject({ status: 'done', fetched: [], fresh: [{ prKey: pr.key }] });
    expect(h.reader.fetchedRefs.length).toBe(fetches);
  });

  it('joins a running full sync instead of stacking a cycle on it', async () => {
    const { h, pr, setNow } = await trackedPr();
    setNow('2026-09-02T12:05:00Z');
    const sync = h.engine.sync({ maxAgentCalls: 0 });
    const result = await h.engine.refreshNow({ kind: 'pr', prKey: pr.key }, AGENT);
    await sync;
    expect(result).toMatchObject({ status: 'done', joinedSync: true });
  });
});
