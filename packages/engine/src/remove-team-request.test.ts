import { UNDO_WINDOW_MS, type FullPr } from '@postpile/core';
import { at, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';

const TEAM = 'acme/team-platform';

/** rowan's PR from outside the team, review routed to the viewer's team; nobody on the team reviewed. */
const routed: FullPr = makePr({ number: 21, author: 'rowan', reviewerTeams: [TEAM], updatedAt: at(6) });

async function synced(options: { thread?: boolean; writesEnabled?: boolean } = {}): Promise<Harness> {
  const h = makeHarness({ writesEnabled: options.writesEnabled ?? true });
  if (options.thread ?? true) {
    h.reader.addPr(routed, makeThreadFor(routed, { reason: 'review_requested' }));
  } else {
    h.reader.addStackPr(routed);
  }
  await h.engine.sync({ maxAgentCalls: 0 });
  if (!(options.thread ?? true)) {
    // No notification: put the PR in the store as a found one would be.
    h.store.prs.upsert(routed, at(7));
  }
  return h;
}

function logged(h: Harness): string[] {
  return h.store.actionLog
    .listRecent(20)
    .filter((entry) => entry.action === 'remove_team_request' || entry.action === 'unsubscribe')
    .map((entry) => `${entry.action} ${entry.origin} ${entry.outcome}`)
    .reverse();
}

describe('removeTeamRequest', () => {
  it('removes the team request, unsubscribes and marks the PR done, in that order', async () => {
    const h = await synced();

    const result = await h.engine.removeTeamRequest(routed.key, TEAM);

    expect(result).toMatchObject({ ok: true, undoToken: null });
    expect(result.settleToken).toEqual(expect.any(String));
    expect(result.message).toBe("Removed team-platform's review request, unsubscribed");
    expect(h.writer.calls).toEqual(['removeTeamReviewRequest acme/app#21 team-platform', 'unsubscribeThread thread-21']);
    expect(logged(h)).toEqual(['remove_team_request detail github', 'unsubscribe detail github']);
    // Until the next sync the stored snapshot mirrors GitHub, so the handled PR is done.
    expect(h.store.prs.get(routed.key)?.reviewerTeams).toEqual([]);
    expect(h.store.userPrStates.get(routed.key)?.handledAt).not.toBeNull();
    expect((await h.engine.getTopic('unsorted'))?.tiles.find((view) => view.tile.id === `pr:${routed.key}`)?.state.kind).toBe('done');
    // The thread is marked read through the normal queue.
    h.timers.advance(UNDO_WINDOW_MS);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.writer.calls).toContain('markThreadRead thread-21');
  });

  it('hands back a settle token, since the mark-read can still fail to reach GitHub after the answer', async () => {
    const h = await synced();
    const result = await h.engine.removeTeamRequest(routed.key, TEAM);
    expect(h.store.userPrStates.get(routed.key)?.handledAt).not.toBeNull();

    // The lock closes inside the undo window: the mark-read does not go out and the PR goes back to how it was.
    await h.engine.setGitHubWrites(false);
    h.timers.advance(UNDO_WINDOW_MS);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.settleToken).toEqual(expect.any(String));
    expect(h.writer.calls).not.toContain('markThreadRead thread-21');
    expect(h.store.userPrStates.get(routed.key)?.handledAt ?? null).toBeNull();
  });

  it('stops when GitHub refuses the removal: nothing else happens', async () => {
    const h = await synced();
    h.writer.failRemoveTeamRequest = true;

    const result = await h.engine.removeTeamRequest(routed.key, TEAM);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Removing team-platform failed: boom');
    expect(h.writer.calls).toEqual([]);
    expect(logged(h)).toEqual(['remove_team_request detail failed']);
    expect(h.store.userPrStates.get(routed.key)?.handledAt ?? null).toBeNull();
    expect(h.store.prs.get(routed.key)?.reviewerTeams).toEqual([TEAM]);
  });

  it('still marks the PR done when the unsubscribe fails, and says so', async () => {
    const h = await synced();
    h.writer.failUnsubscribe = true;

    const result = await h.engine.removeTeamRequest(routed.key, TEAM);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('unsubscribe failed: boom');
    expect(logged(h)).toEqual(['remove_team_request detail github', 'unsubscribe detail failed']);
    expect(h.store.userPrStates.get(routed.key)?.handledAt).not.toBeNull();
  });

  it('skips the unsubscribe without a known thread and says so', async () => {
    const h = await synced({ thread: false });

    const result = await h.engine.removeTeamRequest(routed.key, TEAM);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('no notification thread known, so not unsubscribed');
    expect(h.writer.calls).toEqual(['removeTeamReviewRequest acme/app#21 team-platform']);
  });

  it('is blocked while GitHub writes are locked, and never becomes a pending write', async () => {
    const h = await synced({ writesEnabled: false });

    const result = await h.engine.removeTeamRequest(routed.key, TEAM);

    expect(result).toMatchObject({ ok: false, message: 'GitHub writes are off (lock in the footer): nothing was removed' });
    expect(h.writer.calls).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
    expect(logged(h)).toEqual(['remove_team_request detail skipped']);
    expect(h.store.userPrStates.get(routed.key)?.handledAt ?? null).toBeNull();
  });

  it('refuses a team that is not the viewer own or not requested', async () => {
    const h = await synced();
    expect((await h.engine.removeTeamRequest(routed.key, 'acme/team-other')).ok).toBe(false);
    expect((await h.engine.removeTeamRequest('acme/app#99', TEAM)).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);
  });
});
