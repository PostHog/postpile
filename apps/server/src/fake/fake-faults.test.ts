import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';
import { FakeFaults, fakeDelayFromEnv } from './fake-faults.ts';

const LYRA_PR = 'acme/app#1904';
const ASKED_PR = 'acme/app#1907';

class Clock {
  private ms = new Date('2026-09-27T10:00:00Z').getTime();

  now = (): Date => new Date(this.ms);

  advance(ms: number): void {
    this.ms += ms;
  }
}

function engineWith(faults: FakeFaults, clock = new Clock(), writesLocked = false): FakeEngine {
  return new FakeEngine({ now: clock.now, faults, writesLocked, syncStepMs: 0, recheckDelayMs: 0, catchUpStepMs: 0, cleanupStepMs: 0 });
}

describe('FakeFaults', () => {
  it('reads the kinds to fail from the env, ignoring unknown words', () => {
    const faults = FakeFaults.fromEnv('approve, once:comment, nonsense', undefined, undefined);
    expect(faults.failure('approve', 'POST x')).toBe('GitHub POST x failed with 502: Server Error');
    expect(faults.failure('approve', 'POST x')).not.toBeNull();
    expect(faults.failure('comment', 'POST y')).not.toBeNull();
    expect(faults.failure('comment', 'POST y')).toBeNull();
    expect(faults.failure('reply', 'POST z')).toBeNull();
    expect(FakeFaults.fromEnv('all', undefined, undefined).failure('react', 'POST graphql')).toBe('GitHub POST graphql failed with 403: Resource not accessible by integration');
    expect(FakeFaults.fromEnv(undefined, '1', undefined).failSend).toBe(true);
  });

  it('takes a whole number of milliseconds as the delay, none otherwise', () => {
    expect(fakeDelayFromEnv('1500')).toBe(1500);
    expect(fakeDelayFromEnv('')).toBe(0);
    expect(fakeDelayFromEnv('-3')).toBe(0);
    expect(fakeDelayFromEnv(undefined)).toBe(0);
  });
});

describe('FakeEngine with write faults', () => {
  it('fails an approval with GitHub answer, logs it as failed and changes nothing', async () => {
    const engine = engineWith(FakeFaults.fromEnv('approve', undefined, undefined));
    const head = (await engine.getPr(LYRA_PR))!.pr.headOid;

    const result = await engine.approve(LYRA_PR, head);

    expect(result).toMatchObject({ ok: false, message: 'Approve failed: GitHub POST repos/acme/app/pulls/1904/reviews failed with 502: Server Error' });
    expect((await engine.actionLog(1))[0]).toMatchObject({ action: 'approve', outcome: 'failed', prKey: LYRA_PR });
    const detail = await engine.getPr(LYRA_PR);
    expect(detail?.pr.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(detail?.userState?.approvedAt ?? null).toBeNull();
  });

  it('fails a once: kind on its first call only', async () => {
    const engine = engineWith(FakeFaults.fromEnv('once:comment', undefined, undefined));
    expect((await engine.sendComment(LYRA_PR, 'first try')).message).toMatch(/^Comment failed: GitHub POST repos\/acme\/app\/issues\/1904\/comments failed with 502/);
    expect((await engine.sendComment(LYRA_PR, 'second try')).ok).toBe(true);
  });

  it('checks the head and the lock before the fault, like the real order', async () => {
    const engine = engineWith(FakeFaults.fromEnv('all', undefined, undefined), new Clock(), true);
    expect((await engine.approve(LYRA_PR, 'older-head')).message).toMatch(/New commits since you looked/);
    const head = (await engine.getPr(LYRA_PR))!.pr.headOid;
    expect((await engine.approve(LYRA_PR, head)).message).toMatch(/GitHub writes are off/);
  });

  it('puts a PR back to unread when its queued mark-read fails', async () => {
    const clock = new Clock();
    const engine = engineWith(FakeFaults.fromEnv('mark_read', undefined, undefined), clock);
    const tileId = (await engine.getPr(ASKED_PR))!.tileIds[0]!;
    const hasUnseen = async () => (await engine.listPrEvents(ASKED_PR)).some((view) => view.unseen);
    await engine.markPrRead(tileId, ASKED_PR);
    expect(await hasUnseen()).toBe(false);

    clock.advance(7_000);

    // Reading the log sends the batch whose undo window ran out, like the queue's timer.
    expect((await engine.actionLog(1))[0]).toMatchObject({ action: 'mark_read', outcome: 'failed', detail: expect.stringMatching(/^GitHub didn't take it: .*502/) });
    expect(await hasUnseen()).toBe(true);
  });

  it('keeps pending writes with the error when the send fails (POSTPILE_FAKE_FAIL_SEND)', async () => {
    const clock = new Clock();
    const engine = engineWith(FakeFaults.fromEnv(undefined, '1', undefined), clock, true);
    const tileId = (await engine.getPr(ASKED_PR))!.tileIds[0]!;
    await engine.markPrRead(tileId, ASKED_PR);
    clock.advance(7_000);
    expect((await engine.githubWrites()).pending).toHaveLength(1);
    await engine.setGitHubWrites(true);

    const result = await engine.sendPendingWrites();

    expect(result).toMatchObject({ ok: false, done: 0, failed: 1, message: 'Sent 0 to GitHub, 1 failed and stays pending' });
    expect(result.status.pending[0]?.error).toMatch(/failed with 502/);
    expect(await engine.unreadPrKeys()).toContain(ASKED_PR);
  });

  it('keeps a pending mute with the error when the send fails (POSTPILE_FAKE_FAIL_SEND)', async () => {
    const clock = new Clock();
    const engine = engineWith(FakeFaults.fromEnv(undefined, '1', undefined), clock, true);
    const tileId = (await engine.getPr(ASKED_PR))!.tileIds[0]!;
    await engine.snooze(tileId, { kind: 'muted' });
    clock.advance(7_000);
    expect((await engine.githubWrites()).pending.map((write) => write.kind)).toContain('unsubscribe');
    await engine.setGitHubWrites(true);

    const result = await engine.sendPendingWrites();

    expect(result).toMatchObject({ ok: false, done: 0 });
    const kept = result.status.pending.filter((write) => write.kind === 'unsubscribe');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((write) => /subscription failed with 502/.test(write.error ?? ''))).toBe(true);
    expect((await engine.actionLog(5)).some((entry) => entry.action === 'unsubscribe' && entry.outcome === 'failed')).toBe(true);
    expect((await engine.actionLog(5)).some((entry) => entry.action === 'unsubscribe' && entry.outcome === 'github')).toBe(false);
  });

  it('waits POSTPILE_FAKE_DELAY_MS before a write', async () => {
    const engine = engineWith(new FakeFaults(new Set(), new Set(), false, 30));
    const started = Date.now();
    await engine.draftReviewNote(LYRA_PR, 'approve');
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
