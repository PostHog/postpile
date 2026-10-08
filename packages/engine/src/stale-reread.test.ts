import type { PrKey, PrRef } from '@postpile/core';
import { makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { STALE_REREAD_AFTER_MS, STALE_REREADS_PER_CHECK } from './github-sync.ts';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';

const HOUR_MS = 60 * 60 * 1000;

function fetchedKeys(h: Harness, from: number): PrKey[] {
  return h.reader.fetchedRefs.slice(from).flatMap((refs: PrRef[]) => refs.map((ref) => `${ref.repo}#${ref.number}`));
}

/** A harness whose clock the test moves, with PR #1 asking the viewer for a review and PR #2 read with nothing asked. */
async function syncedHarness(): Promise<{ h: Harness; setNow: (ms: number) => void }> {
  let now = NOW.getTime();
  const h = makeHarness({ now: () => new Date(now) });
  const asked = makePr({ number: 1, author: 'alice', reviewerUsers: [viewer.login] });
  const quiet = makePr({ number: 2, author: 'alice' });
  h.reader.addPr(asked, makeThreadFor(asked, { unread: false, lastReadAt: asked.updatedAt }));
  h.reader.addPr(quiet, makeThreadFor(quiet, { unread: false, lastReadAt: quiet.updatedAt, reason: 'subscribed' }));
  await h.engine.sync({ maxAgentCalls: 0 });
  return { h, setNow: (ms) => (now = ms) };
}

describe('stale re-reads', () => {
  it('fetches an open PR that waits on the viewer again once its snapshot is old, news or not', async () => {
    const { h, setNow } = await syncedHarness();

    setNow(NOW.getTime() + HOUR_MS);
    let from = h.reader.fetchedRefs.length;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(fetchedKeys(h, from)).toEqual([]);

    setNow(NOW.getTime() + STALE_REREAD_AFTER_MS + HOUR_MS);
    from = h.reader.fetchedRefs.length;
    await h.engine.sync({ maxAgentCalls: 0 });
    // Only the PR on the viewer's move; the read PR with nothing asked stays as it is.
    expect(fetchedKeys(h, from)).toEqual(['acme/app#1']);
    expect(h.store.prs.fetchedAt('acme/app#1')).toBe(new Date(NOW.getTime() + STALE_REREAD_AFTER_MS + HOUR_MS).toISOString());
  });

  it('leaves a snoozed tile alone, like whats_on_me does', async () => {
    const { h, setNow } = await syncedHarness();
    await h.engine.snooze('pr:acme/app#1', { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' });

    setNow(NOW.getTime() + STALE_REREAD_AFTER_MS + HOUR_MS);
    const from = h.reader.fetchedRefs.length;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(fetchedKeys(h, from)).toEqual([]);
  });

  it('re-reads at most a few per check, oldest first', async () => {
    let now = NOW.getTime();
    const h = makeHarness({ now: () => new Date(now) });
    const count = STALE_REREADS_PER_CHECK + 2;
    for (let number = 1; number <= count; number += 1) {
      const pr = makePr({ number, author: 'alice', reviewerUsers: [viewer.login] });
      h.reader.addPr(pr, makeThreadFor(pr, { unread: false, lastReadAt: pr.updatedAt }));
    }
    await h.engine.sync({ maxAgentCalls: 0 });

    now += STALE_REREAD_AFTER_MS + HOUR_MS;
    const from = h.reader.fetchedRefs.length;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(fetchedKeys(h, from)).toHaveLength(STALE_REREADS_PER_CHECK);
  });
});
