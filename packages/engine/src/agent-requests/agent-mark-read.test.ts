import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSeenThrough, seenThroughToken, UNDO_WINDOW_MS, type AgentRequestResult, type FullPr } from '@postpile/core';
import { at, makeComment, makeEvent, makePr, makeThread, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { topicWithPrs } from '../testing/topics.ts';
import { answerAgentRequest } from './answer.ts';
import { AgentRequestInbox } from './inbox.ts';

const CLIENT = { client: 'claude-code' };

/** A PR the viewer follows, unread on GitHub: alice commented, nothing asks the viewer anything. */
function followedPr(number: number, comments = [makeComment({ id: `c${number}`, author: 'alice', body: 'moved the cache keys', createdAt: at(5) })]): FullPr {
  return makePr({ number, author: 'alice', comments, updatedAt: at(6) });
}

const pr = followedPr(11);

async function synced(): Promise<Harness> {
  const h = makeHarness();
  topicWithPrs(h, 'cache', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

async function seenThrough(h: Harness, key: string): Promise<string> {
  return (await h.engine.getPr(key))?.seenThrough ?? '';
}

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('markReadForAgent', () => {
  it('marks a PR read like the pane button: one batch, toast notice with undo, GitHub after the window', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);
    expect(parseSeenThrough(seen)?.seq).toBeGreaterThan(0);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(result).toMatchObject({ marked: [pr.key], refused: [], skipped: [], writesLocked: false, undoUntil: expect.any(String) });
    const notice = (await h.engine.livePollStatus()).agentReads[0];
    expect(notice).toMatchObject({ id: 1, client: 'claude-code', prKeys: [pr.key], writesLocked: false });
    expect(h.writer.calls).toEqual([]);
    const log = await h.engine.actionLog(5);
    expect(log.find((row) => row.action === 'agent_mark_read')?.detail).toContain(`claude-code: marked read ${pr.key}`);
    expect(log.find((row) => row.action === 'mark_read')?.origin).toBe('agent');

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.writer.calls).toEqual([`markThreadRead thread-${pr.ref.number}`]);
  });

  it('keeps every notice, so two calls between polls both get a toast, and says when Undo is over', async () => {
    const h = makeHarness();
    const other = followedPr(12);
    topicWithPrs(h, 'cache', [pr, other]);
    await h.engine.sync({ maxAgentCalls: 0 });

    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: await seenThrough(h, pr.key) }] }, CLIENT);
    await h.engine.markReadForAgent({ prs: [{ prKey: other.key, seenThrough: await seenThrough(h, other.key) }] }, { client: 'codex-mcp-client' });

    const notices = (await h.engine.livePollStatus()).agentReads;
    expect(notices.map((notice) => [notice.id, notice.client, notice.prKeys])).toEqual([
      [1, 'claude-code', [pr.key]],
      [2, 'codex-mcp-client', [other.key]],
    ]);
    expect(new Set(notices.map((notice) => notice.undoToken)).size).toBe(2);

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect((await h.engine.livePollStatus()).agentReads.map((notice) => [notice.id, notice.undoable])).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it('can be undone from the toast inside the window, and nothing reaches GitHub', async () => {
    const h = await synced();
    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: await seenThrough(h, pr.key) }] }, CLIENT);
    const token = (await h.engine.livePollStatus()).agentReads[0]?.undoToken ?? null;

    expect((await h.engine.undo(token)).ok).toBe(true);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.writer.calls).toEqual([]);
    expect(h.store.userPrStates.get(pr.key)?.handledAt ?? null).toBeNull();
  });

  it('refuses a PR with activity logged after seen_through, and still marks the others of the call', async () => {
    const h = makeHarness();
    const other = followedPr(12);
    topicWithPrs(h, 'cache', [pr, other]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const seen = await seenThrough(h, pr.key);
    const otherSeen = await seenThrough(h, other.key);

    // bob comments after the agent read the PR; the next sync stores it.
    const moved = followedPr(11, [...pr.comments, makeComment({ id: 'c11b', author: 'bob', body: 'one more thing', createdAt: at(8) })]);
    h.reader.addPr({ ...moved, updatedAt: at(9) }, makeThreadFor(moved, { reason: 'subscribed', updatedAt: at(9) }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    const result = await h.engine.markReadForAgent(
      {
        prs: [
          { prKey: pr.key, seenThrough: seen },
          { prKey: other.key, seenThrough: otherSeen },
        ],
      },
      CLIENT,
    );

    expect(result.marked).toEqual([other.key]);
    expect(result.refused).toEqual([{ prKey: pr.key, reason: 'new activity since you read it: 1 event, newest from bob; read it again with pr_context' }]);
  });

  it('reads seen_through before the activity, so a sync landing in between makes mark_read refuse', async () => {
    const h = await synced();
    const log = h.store.eventLog;
    const watermark = log.maxSeqForPr.bind(log);
    // Another connection commits carol's comment right after the watermark was read.
    log.maxSeqForPr = (key) => {
      const seq = watermark(key);
      const late = makeEvent({ id: `${pr.key}:comment:late`, prKey: pr.key, kind: 'comment', actor: 'carol', sourceId: 'late', summary: 'carol commented', at: at(9) });
      h.store.events.upsertDerived(pr.key, [...h.store.events.listForPr(pr.key), late]);
      log.append([{ id: late.id, prKey: pr.key }], at(9));
      log.maxSeqForPr = watermark;
      return seq;
    };

    const detail = await h.engine.getPr(pr.key);
    const shown = [...(detail?.activity.fresh ?? []), ...(detail?.activity.earlier ?? [])];
    expect(shown.some((line) => line.actor === 'carol')).toBe(true);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: detail?.seenThrough ?? '' }] }, CLIENT);
    expect(result.marked).toEqual([]);
    expect(result.refused[0]?.reason).toContain('newest from carol');
  });

  it('refuses an old token once an Undo brought events back unseen that the read did not list', async () => {
    const h = await synced();
    // The user marks the PR read in the pane, and the agent reads it then: nothing unread to list.
    const tileId = (await h.engine.getPr(pr.key))?.tileIds[0] ?? '';
    const clicked = await h.engine.markPrRead(tileId, pr.key);
    const seen = await seenThrough(h, pr.key);
    expect((await h.engine.getPr(pr.key))?.unread).toEqual([]);
    // The user takes the click back inside the window: alice's comment is unseen again, the event log did not move.
    expect((await h.engine.undo(clicked.undoToken)).ok).toBe(true);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(result.marked).toEqual([]);
    expect(result.refused).toEqual([{ prKey: pr.key, reason: 'the unread list changed since you read it; read it again' }]);
  });

  it('keeps the toast notice after the undo window, without Undo, so a window shown later still hears of it', async () => {
    const h = await synced();
    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: await seenThrough(h, pr.key) }] }, CLIENT);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect((await h.engine.livePollStatus()).agentReads).toMatchObject([{ id: 1, prKeys: [pr.key], undoable: false }]);
  });

  it('refuses a seen_through ahead of what PostPile stores, and a PR it does not track', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);

    const result = await h.engine.markReadForAgent(
      {
        prs: [
          { prKey: pr.key, seenThrough: seenThroughToken((parseSeenThrough(seen)?.seq ?? 0) + 100, []) },
          { prKey: 'acme/app#999', seenThrough: '0-0' },
        ],
      },
      CLIENT,
    );

    expect(result.marked).toEqual([]);
    expect(result.refused.map((entry) => entry.prKey)).toEqual([pr.key, 'acme/app#999']);
    expect(result.refused[0]?.reason).toContain('is not one pr_context printed');
    expect((await h.engine.livePollStatus()).agentReads).toEqual([]);
    expect((await h.engine.actionLog(1))[0]).toMatchObject({ action: 'agent_mark_read', outcome: 'skipped' });
  });

  it('skips a PR that is already read', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);
    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    const again = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(again).toMatchObject({ marked: [], skipped: [{ prKey: pr.key, reason: 'already read' }] });
  });

  it('skips a PR whose mark-read waits in the undo window: a retry adds no second batch', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);
    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    const retry = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(retry).toMatchObject({ marked: [], skipped: [{ prKey: pr.key, reason: 'already queued to mark read' }] });
    expect((await h.engine.livePollStatus()).agentReads).toHaveLength(1);
  });

  it('refuses a PR whose notification moved after PostPile fetched it', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);
    // The inbox saw newer activity, but the PR fetch that would store it failed.
    const thread = h.store.notifications.getByPrKey(pr.key);
    const fetchedAt = h.store.prs.fetchedAt(pr.key) ?? '';
    h.store.notifications.upsertMany([{ ...thread!, updatedAt: new Date(Date.parse(fetchedAt) + 60_000).toISOString() }]);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(result.marked).toEqual([]);
    expect(result.refused).toEqual([{ prKey: pr.key, reason: 'PostPile has newer activity than it fetched; call refresh_from_github, then read it again' }]);
  });

  it('skips a stack layer only pulled in for context', async () => {
    const h = makeHarness();
    const below = makePr({ number: 10, baseRef: 'master', headRef: 'l10', comments: [makeComment({ id: 'c10', author: 'bob', body: 'rebased' })] });
    const pinged = reviewRequestedPr(11, { baseRef: 'l10', headRef: 'l11' });
    topicWithPrs(h, 'depot', [pinged]);
    h.reader.addStackPr(below);
    await h.engine.sync({ maxAgentCalls: 0 });

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: below.key, seenThrough: await seenThrough(h, below.key) }] }, CLIENT);

    expect(result.marked).toEqual([]);
    expect(result.skipped[0]?.reason).toContain('stack layer');
  });

  it('while GitHub writes are locked queues it like a locked button: nothing changes here, pending after the window', async () => {
    const h = await synced();
    await h.engine.setGitHubWrites(false);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: await seenThrough(h, pr.key) }] }, CLIENT);

    expect(result).toMatchObject({ marked: [pr.key], writesLocked: true });
    expect(h.store.userPrStates.get(pr.key)?.handledAt ?? null).toBeNull();
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.writer.calls).toEqual([]);
    expect((await h.engine.actionLog(10)).some((row) => row.action === 'mark_read' && row.outcome === 'pending')).toBe(true);
  });

  it('while locked, two calls for the same PR give one pending write', async () => {
    const h = await synced();
    await h.engine.setGitHubWrites(false);
    const seen = await seenThrough(h, pr.key);

    await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);
    const duringWindow = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    const whilePending = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(duringWindow.skipped).toEqual([{ prKey: pr.key, reason: 'already queued to mark read' }]);
    expect(whilePending.skipped).toEqual([{ prKey: pr.key, reason: 'already queued to mark read' }]);
    expect(h.store.pendingWrites.list().filter((write) => write.kind === 'mark_read')).toHaveLength(1);
  });
});

describe('mark_read through the request folder', () => {
  const NOW = new Date('2026-09-29T12:00:00Z');
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  function envelope(payload: unknown): string {
    return JSON.stringify({ v: 1, kind: 'mark_read', createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), client: 'claude-code', payload });
  }

  async function answer(h: Harness, payload: unknown): Promise<AgentRequestResult> {
    const dir = join(mkdtempSync(join(tmpdir(), 'postpile-mark-read-')), 'agent-requests');
    const box = new AgentRequestInbox({ folder: dir, now: () => NOW, log: () => {}, watch: false, rescanMs: 0, handle: (request) => answerAgentRequest(h.engine, request) });
    box.start();
    writeFileSync(join(dir, `${ID}.json`), envelope(payload));
    await box.scan();
    box.stop();
    return JSON.parse(readFileSync(join(dir, `${ID}.result.json`), 'utf8')) as AgentRequestResult;
  }

  it('answers with what was marked', async () => {
    const h = await synced();
    const result = await answer(h, { prs: [{ prKey: pr.key, seenThrough: await seenThrough(h, pr.key) }] });
    expect(result).toMatchObject({ ok: true, kind: 'mark_read', markRead: { marked: [pr.key] } });
  });

  it('refuses more than 20 PRs in one call and marks none of them', async () => {
    const h = await synced();
    const prs = Array.from({ length: 21 }, (_, index) => ({ prKey: `acme/app#${index + 1}`, seenThrough: '0-0' }));
    const result = await answer(h, { prs });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('one to 20 PRs') });
    expect((await h.engine.livePollStatus()).agentReads).toEqual([]);
  });
});

describe('Unread since you looked (PrDetail.unread)', () => {
  const BOT = 'greptile-apps[bot]';
  const botComment = makeComment({ id: 'g1', author: BOT, body: 'The port is hardcoded.', createdAt: at(2) });
  const reply = makeComment({ id: 'a1', author: 'alice', body: 'Moved it into the config.\n\nAlso added a test.', createdAt: at(3) });
  const thread = makeThread('t1', [botComment, reply]);
  const talk = Array.from({ length: 14 }, (_, index) =>
    makeComment({ id: `b${index}`, author: 'bob', body: index === 0 ? 'First paragraph of a long note.\n\nSecond paragraph with the point.' : `note ${index}`, createdAt: at(4 + index) }),
  );
  const busy = makePr({ number: 21, author: 'viewer', comments: [...thread.comments, ...talk], threads: [thread], updatedAt: at(30) });

  it('lists every unseen event with full text, even ones the activity folds, mutes or caps, and seen_through covers nothing else', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'busy', [busy]);
    await h.engine.sync({ maxAgentCalls: 0 });
    // The events agent muted one of bob's comments: the activity folds it into the noise.
    const muted = h.store.events.listForPr(busy.key).find((event) => event.sourceId === 'b5');
    h.store.events.setOverride(muted!.id, { loudness: 'muted', reason: 'chatter', by: 'agent' });

    const detail = (await h.engine.getPr(busy.key))!;

    const lines = [...detail.activity.fresh, ...detail.activity.earlier];
    expect(lines.some((line) => line.fold === 'bot_thread')).toBe(true);
    expect(detail.activity.noise.some((event) => event.id === muted!.id) || detail.activity.freshNoise.some((event) => event.id === muted!.id)).toBe(true);
    expect(lines.length).toBeGreaterThan(detail.activity.cap);

    const unread = detail.unread;
    expect(unread.find((event) => event.actor === 'alice')?.body).toBe('Moved it into the config.\n\nAlso added a test.');
    expect(unread.find((event) => event.id === muted!.id)?.body).toBe('note 5');
    expect(unread.find((event) => event.body?.startsWith('First paragraph'))?.body).toBe('First paragraph of a long note.\n\nSecond paragraph with the point.');
    expect(unread.filter((event) => event.actor === 'bob')).toHaveLength(14);
    // Everything a mark-read with this seen_through would mark seen is in the list.
    const covered = h.store.eventLog
      .listSince([busy.key], 0)
      .filter((entry) => entry.seq <= (parseSeenThrough(detail.seenThrough)?.seq ?? -1) && entry.event.seenAt === null)
      .map((entry) => entry.event.id);
    expect(covered.length).toBeGreaterThan(12);
    expect(new Set(unread.map((event) => event.id))).toEqual(new Set(covered));
  });
});

describe('waitingPrKeys after a partly sent pending write', () => {
  it('stops counting a PR once its thread went out, so mark_read can handle it again', async () => {
    const h = makeHarness();
    const other = followedPr(12);
    topicWithPrs(h, 'cache', [pr, other]);
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setGitHubWrites(false);
    await h.engine.markReadForAgent(
      {
        prs: [
          { prKey: pr.key, seenThrough: await seenThrough(h, pr.key) },
          { prKey: other.key, seenThrough: await seenThrough(h, other.key) },
        ],
      },
      CLIENT,
    );
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.store.pendingWrites.list()).toHaveLength(1);

    // Sending it gets one thread through; the other fails and stays pending.
    await h.engine.setGitHubWrites(true);
    h.writer.failingThreads.add(`thread-${other.ref.number}`);
    await h.engine.sendPendingWrites();

    const left = h.store.pendingWrites.list();
    expect(left).toHaveLength(1);
    expect(left[0]?.threads.map((thread) => thread.prKey)).toEqual([other.key]);
    const retry = await h.engine.markReadForAgent(
      {
        prs: [
          { prKey: pr.key, seenThrough: await seenThrough(h, pr.key) },
          { prKey: other.key, seenThrough: await seenThrough(h, other.key) },
        ],
      },
      CLIENT,
    );
    expect(retry.skipped).toEqual([
      { prKey: pr.key, reason: 'already read' },
      { prKey: other.key, reason: 'already queued to mark read' },
    ]);
  });
});
