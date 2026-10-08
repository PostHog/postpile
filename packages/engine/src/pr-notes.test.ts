import type { PrDetail, PrKey } from '@postpile/core';
import { at, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const client = { client: 'claude-code' };

async function depot(): Promise<{ h: Harness; first: PrKey; second: PrKey }> {
  const h = makeHarness();
  const first = reviewRequestedPr(1);
  const second = reviewRequestedPr(2);
  topicWithPrs(h, 'depot', [first, second]);
  await h.engine.sync({ maxAgentCalls: 0 });
  return { h, first: first.key, second: second.key };
}

async function tokenOf(h: Harness, key: PrKey): Promise<string> {
  return (await h.engine.getPr(key))?.notes.token ?? '';
}

/** Everything the board shows: sidebar items with their counts, the topic's tiles with turn and unread, and the PR pane minus its notes. */
async function board(h: Harness, keys: PrKey[]): Promise<unknown> {
  const withoutNotes = (detail: PrDetail | null) => (detail ? { ...detail, notes: null } : null);
  return {
    topics: await h.engine.listTopics(),
    topic: await h.engine.getTopic('depot'),
    prs: await Promise.all(keys.map(async (key) => withoutNotes(await h.engine.getPr(key)))),
  };
}

describe('agent notes on PRs', () => {
  it('never change whose move, unread, sections or counts', async () => {
    const { h, first, second } = await depot();
    const before = await board(h, [first, second]);

    const set = await h.engine.notePr({ action: 'set', prKey: first, kind: 'covered', note: 'reviewed with #2', by: 'ph3 session', token: await tokenOf(h, first), coveredByPrKey: second, coverToken: null, leaseMinutes: null }, client);
    expect(set.status).toBe('set');
    await h.engine.notePr({ action: 'set', prKey: second, kind: 'in_progress', note: 'reviewing now', by: 'ph3 session', token: await tokenOf(h, second), coveredByPrKey: null, coverToken: null, leaseMinutes: 60 }, client);

    expect(await board(h, [first, second])).toEqual(before);
    expect((await h.engine.getPr(first))?.notes.durable).toMatchObject({ kind: 'covered', coveredBy: second, status: 'live' });
  });

  it('writes a retried request once and refuses a token from an older state', async () => {
    const { h, first } = await depot();
    const request = { action: 'set' as const, prKey: first, kind: 'no_action' as const, note: 'nothing to do', by: 'ph3 session', token: await tokenOf(h, first), coveredByPrKey: null, coverToken: null, leaseMinutes: null };

    const set = await h.engine.notePr(request, client);
    const again = await h.engine.notePr(request, client);
    expect(again).toMatchObject({ status: 'unchanged', note: { id: set.note?.id } });
    expect(h.store.prNotes.listForPrs([first])).toHaveLength(1);

    const stale = await h.engine.notePr({ ...request, token: 'older-token' }, client);
    expect(stale).toMatchObject({ status: 'refused', reason: expect.stringContaining('changed since you read it') });
  });

  it('goes stale when the PR moves on, and the user can clear it', async () => {
    const { h, first } = await depot();
    const set = await h.engine.notePr({ action: 'set', prKey: first, kind: 'no_action', note: 'nothing to do', by: 'ph3 session', token: await tokenOf(h, first), coveredByPrKey: null, coverToken: null, leaseMinutes: null }, client);
    const changesBefore = (await h.engine.livePollStatus()).changeCount;

    const pushed = reviewRequestedPr(1, { headOid: 'pushed', updatedAt: at(50) });
    h.reader.addPr(pushed, makeThreadFor(pushed, { updatedAt: at(50) }));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.getPr(first))?.notes.durable).toMatchObject({ status: 'stale', staleReasons: ['head changed'] });
    expect(await h.engine.listPrNotes([first, 'acme/app#2'])).toHaveLength(1);

    expect(await h.engine.clearPrNote(set.note?.id ?? '')).toMatchObject({ status: 'cleared' });
    expect((await h.engine.getPr(first))?.notes.durable).toBeNull();
    expect(h.store.prNotes.get(set.note?.id ?? '')?.clearedBy).toBe('user');
    expect((await h.engine.livePollStatus()).changeCount).toBeGreaterThan(changesBefore);
  });
});
