import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNDO_WINDOW_MS, type AgentRequestResult, type FullPr } from '@postpile/core';
import { at, makeComment, makeEvent, makePr, makeThreadFor } from '@postpile/core/fixtures';
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

async function seenThrough(h: Harness, key: string): Promise<number> {
  return (await h.engine.getPr(key))?.seenThrough ?? -1;
}

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('markReadForAgent', () => {
  it('marks a PR read like the pane button: one batch, toast notice with undo, GitHub after the window', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);
    expect(seen).toBeGreaterThan(0);

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

  it('keeps every notice until its undo window ends, so two calls between polls both get a toast', async () => {
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
    expect((await h.engine.livePollStatus()).agentReads).toEqual([]);
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

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: detail?.seenThrough ?? 0 }] }, CLIENT);
    expect(result.marked).toEqual([]);
    expect(result.refused[0]?.reason).toContain('newest from carol');
  });

  it('refuses a seen_through ahead of what PostPile stores, and a PR it does not track', async () => {
    const h = await synced();
    const seen = await seenThrough(h, pr.key);

    const result = await h.engine.markReadForAgent(
      {
        prs: [
          { prKey: pr.key, seenThrough: seen + 100 },
          { prKey: 'acme/app#999', seenThrough: 0 },
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

    const again = await h.engine.markReadForAgent({ prs: [{ prKey: pr.key, seenThrough: seen }] }, CLIENT);

    expect(again).toMatchObject({ marked: [], skipped: [{ prKey: pr.key, reason: 'already read' }] });
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
    const prs = Array.from({ length: 21 }, (_, index) => ({ prKey: `acme/app#${index + 1}`, seenThrough: 0 }));
    const result = await answer(h, { prs });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('one to 20 PRs') });
    expect((await h.engine.livePollStatus()).agentReads).toEqual([]);
  });
});
