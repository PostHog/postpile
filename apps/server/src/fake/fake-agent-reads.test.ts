import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const CLIENT = { client: 'claude-code' };
const PR = 'acme/app#1902';

describe('FakeEngine.markReadForAgent', () => {
  it('marks a sample PR read with a toast notice and undo, and skips a retry while it waits', async () => {
    const engine = new FakeEngine();
    const seenThrough = (await engine.getPr(PR))?.seenThrough ?? -1;
    expect(seenThrough).toBeGreaterThan(0);

    const result = await engine.markReadForAgent({ prs: [{ prKey: PR, seenThrough }] }, CLIENT);

    expect(result).toMatchObject({ marked: [PR], refused: [], skipped: [], undoUntil: expect.any(String) });
    const notice = (await engine.livePollStatus()).agentReads[0];
    expect(notice).toMatchObject({ id: 1, client: 'claude-code', prKeys: [PR] });
    expect((await engine.actionLog(10)).some((row) => row.action === 'agent_mark_read' && row.detail.startsWith('claude-code: marked read'))).toBe(true);
    expect(await engine.markReadForAgent({ prs: [{ prKey: PR, seenThrough }] }, CLIENT)).toMatchObject({ marked: [], skipped: [{ prKey: PR, reason: 'already queued to mark read' }] });

    expect((await engine.undo(notice?.undoToken ?? null)).ok).toBe(true);
  });

  it('refuses a seen_through older than the sample events, and an unknown PR', async () => {
    const engine = new FakeEngine();
    const seenThrough = (await engine.getPr(PR))?.seenThrough ?? 0;

    const result = await engine.markReadForAgent(
      {
        prs: [
          { prKey: PR, seenThrough: seenThrough - 1 },
          { prKey: 'acme/app#9999', seenThrough: 0 },
        ],
      },
      CLIENT,
    );

    expect(result.marked).toEqual([]);
    expect(result.refused[0]?.reason).toMatch(/^new activity since you read it: 1 event, newest from /);
    expect(result.refused[1]).toEqual({ prKey: 'acme/app#9999', reason: 'PostPile does not track this PR' });
    expect((await engine.livePollStatus()).agentReads).toEqual([]);
  });
});
