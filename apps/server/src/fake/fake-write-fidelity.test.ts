import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const LYRA_PR = 'acme/app#1904';
// Open in the sample with an unread notification thread.
const UNREAD_PR = 'acme/app#1907';

function engineAt(iso = '2026-09-27T10:00:00Z'): FakeEngine {
  const now = new Date(iso);
  return new FakeEngine({ now: () => now, syncStepMs: 0, recheckDelayMs: 0, catchUpStepMs: 0, cleanupStepMs: 0 });
}

describe('FakeEngine writes land on the sample PR like GitHub would show them', () => {
  it('approves with an APPROVED review by the viewer on the head, so the pill, the approval and the activity agree', async () => {
    const engine = engineAt();
    const before = await engine.getPr(LYRA_PR);
    expect(before?.pr.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(before?.viewerReview).toBe('requested');

    const result = await engine.approve(LYRA_PR, before!.pr.headOid);

    expect(result.ok).toBe(true);
    const after = await engine.getPr(LYRA_PR);
    expect(after?.pr.reviewDecision).toBe('APPROVED');
    expect(after?.status.review).toBe('approved');
    expect(after?.viewerApproval).toMatchObject({ at: '2026-09-27T10:00:00.000Z', commitOid: before!.pr.headOid });
    // GitHub drops the reviewer's own request once they review.
    expect(after?.viewerReview).toBeNull();
    const approval = (await engine.listPrEvents(LYRA_PR)).find((view) => view.event.kind === 'review_approved');
    expect(approval).toMatchObject({ event: { actor: 'you' }, unseen: false });
    expect(after?.activity.earlier[0]).toMatchObject({ kind: 'review_approved', actor: 'you' });
  });

  it('keeps an approve note as the review body', async () => {
    const engine = engineAt();
    const head = (await engine.getPr(LYRA_PR))!.pr.headOid;
    await engine.approve(LYRA_PR, head, 'Looks good, ship it.');
    const approval = (await engine.listPrEvents(LYRA_PR)).find((view) => view.event.kind === 'review_approved');
    expect(approval?.event.summary).toContain('Looks good, ship it.');
  });

  it('refuses a PR that is not open, a moved head and a locked write without adding a review', async () => {
    const engine = engineAt();
    expect((await engine.approve('acme/app#1855', 'sha1855')).message).toMatch(/not an open PR/);
    expect((await engine.approve(LYRA_PR, 'older-head')).message).toMatch(/New commits since you looked/);
    await engine.setGitHubWrites(false);
    const head = (await engine.getPr(LYRA_PR))!.pr.headOid;
    expect((await engine.approve(LYRA_PR, head)).ok).toBe(false);
    expect((await engine.getPr(LYRA_PR))?.pr.reviewDecision).toBe('REVIEW_REQUIRED');
    expect((await engine.listPrEvents(LYRA_PR)).some((view) => view.event.kind === 'review_approved')).toBe(false);
  });

  it('posts a comment review as a reviewed line that does not approve', async () => {
    const engine = engineAt();
    const head = (await engine.getPr(LYRA_PR))!.pr.headOid;
    expect((await engine.commentReview(LYRA_PR, head, 'One question on the cache key.')).ok).toBe(true);
    const after = await engine.getPr(LYRA_PR);
    expect(after?.pr.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(after?.viewerApproval).toBeNull();
    const review = (await engine.listPrEvents(LYRA_PR)).find((view) => view.event.kind === 'review_commented');
    expect(review).toMatchObject({ event: { actor: 'you' }, unseen: false });
  });

  it('adds a sent comment to the PR and its activity', async () => {
    const engine = engineAt();
    expect((await engine.sendComment(LYRA_PR, '@lyra is the lockfile hash stable across pnpm versions?')).ok).toBe(true);
    const comment = (await engine.listPrEvents(LYRA_PR)).find((view) => view.event.kind === 'comment' && view.event.actor === 'you');
    expect(comment).toMatchObject({ event: { summary: expect.stringContaining('lockfile hash') }, unseen: false });
    expect((await engine.sendComment(LYRA_PR, '  ')).message).toBe('Empty comment');
  });
});

describe('FakeEngine approvals mark the PR read like the engine does', () => {
  async function threadUnread(engine: FakeEngine, prKey: string): Promise<boolean> {
    const rows = await engine.debugNotifications(200);
    return rows.some((row) => row.prKey === prKey && row.thread.unread);
  }

  async function settled(engine: FakeEngine, advance: () => void): Promise<void> {
    advance();
    await engine.debugNotifications(1);
  }

  it('reads the thread after approve, with a settle token and no NEW from the own approval', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now, syncStepMs: 0, recheckDelayMs: 0, catchUpStepMs: 0, cleanupStepMs: 0 });
    const head = (await engine.getPr(UNREAD_PR))!.pr.headOid;
    expect(await threadUnread(engine, UNREAD_PR)).toBe(true);
    const result = await engine.approve(UNREAD_PR, head, 'Looks good.');
    expect(result.settleToken).toEqual(expect.any(String));
    await settled(engine, () => {
      now = new Date(now.getTime() + 7000);
    });
    expect(await threadUnread(engine, UNREAD_PR)).toBe(false);
  });

  it('reads the thread after a comment review', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now, syncStepMs: 0, recheckDelayMs: 0, catchUpStepMs: 0, cleanupStepMs: 0 });
    const head = (await engine.getPr(UNREAD_PR))!.pr.headOid;
    const result = await engine.commentReview(UNREAD_PR, head, 'One question.');
    expect(result.settleToken).toEqual(expect.any(String));
    await settled(engine, () => {
      now = new Date(now.getTime() + 7000);
    });
    expect(await threadUnread(engine, UNREAD_PR)).toBe(false);
  });
});
