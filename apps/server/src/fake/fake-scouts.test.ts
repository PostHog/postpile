// The Scouted section on sample data (fake-scouts.ts): every state shows,
// Follow goes through the undo window and the lock, Dismiss and seen stay local.
import { UNDO_WINDOW_MS } from '@postpile/core';
import { UNSORTED_TOPIC_ID } from '@postpile/engine';
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const START = new Date('2026-09-29T12:00:00Z').getTime();
const LOOKOUT = 'scout:lookout-structure';
const LEDGER = 'acme/app#2701';
const ROUNDING = 'acme/app#2711';
const HOST = 'acme/app#2704';

function engineAt(options: { writesLocked?: boolean } = {}): { engine: FakeEngine; later: (ms: number) => void } {
  let now = START;
  const engine = new FakeEngine({ now: () => new Date(now), writesLocked: options.writesLocked });
  return { engine, later: (ms) => (now += ms) };
}

describe('FakeEngine scouts', () => {
  it('lists the scouts in file order with their tiles and unseen counts, an empty scout too', async () => {
    const { engine } = engineAt();
    expect(await engine.listScouts()).toEqual([
      { id: 'lookout-structure', topicId: LOOKOUT, name: 'Lookout · structure', tiles: 4, unseen: 2 },
      { id: 'billing-watch', topicId: 'scout:billing-watch', name: 'Billing watch', tiles: 1, unseen: 0 },
      { id: 'docs-drift', topicId: 'scout:docs-drift', name: 'Docs drift', tiles: 0, unseen: 0 },
    ]);
  });

  it('opens a scout like a topic: its tiles with the scout part, nothing a topic carries beyond them', async () => {
    const { engine } = engineAt();
    const detail = await engine.getTopic(LOOKOUT);
    expect(detail).toMatchObject({ driver: null, dossier: null, archive: null, sets: [], yourMoves: [], scout: { id: 'lookout-structure', tiles: 4 } });
    expect(detail?.tiles.every((view) => view.scout?.scoutName === 'Lookout · structure')).toBe(true);
    const stack = detail?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.scout).toMatchObject({ prKeys: [HOST, 'acme/app#2705'], unseen: true, follow: null });
    expect(stack?.prs.map((pr) => pr.key)).toEqual([HOST, 'acme/app#2705']);
    expect(detail?.tiles.find((view) => view.prs.some((pr) => pr.key === LEDGER))?.scout?.reason).toBe('adds services/, a new top-level folder for the ledger service');
  });

  it('keeps scouted PRs out of the topics, the unread keys and the Dock badge', async () => {
    const { engine } = engineAt();
    const topics = await engine.listTopics();
    expect(topics.some((item) => item.topic.id.startsWith('scout:'))).toBe(false);
    expect(await engine.unreadPrKeys()).not.toContain(LEDGER);
  });

  it('shows the history: a dismissed, an expired and a followed PR are not on the section; the followed one sits in Unsorted', async () => {
    const { engine } = engineAt();
    const keys = (await engine.getTopic(LOOKOUT))?.tiles.flatMap((view) => view.prs.map((pr) => pr.key)) ?? [];
    expect(keys).not.toContain('acme/app#2721');
    expect(keys).not.toContain('acme/app#2723');
    const unsorted = await engine.getTopic(UNSORTED_TOPIC_ID);
    expect(unsorted?.tiles.map((view) => view.tile.members[0]?.provenance)).toEqual([expect.objectContaining({ kind: 'found', via: 'followed' })]);
    const followed = await engine.getPr('acme/app#2723');
    expect(followed?.scouted).toMatchObject({ active: false, tracked: true, followedAt: expect.any(String) });
  });

  it("gives a scouted PR's pane its scout, reason and topic", async () => {
    const { engine } = engineAt();
    const detail = await engine.getPr(LEDGER);
    expect(detail?.topicId).toBe(LOOKOUT);
    expect(detail?.scouted).toMatchObject({ scoutName: 'Lookout · structure', active: true, tracked: false, unseen: true, follow: null });
  });

  it("shows Billing watch's failed Follow on its tile and in the lock", async () => {
    const { engine } = engineAt();
    const billing = await engine.getTopic('scout:billing-watch');
    expect(billing?.tiles[0]?.scout?.follow).toBe('failed');
    const pending = (await engine.githubWrites()).pending;
    expect(pending).toEqual([expect.objectContaining({ kind: 'follow', title: 'Follow: Round usage tiers per invoice line, not per invoice', error: expect.any(String) })]);
    expect(await engine.followScouted(ROUNDING, 'tile')).toMatchObject({ ok: true, message: 'Follow already on its way' });
  });

  it('follows after the undo window: the PR leaves the section for Unsorted, tracked', async () => {
    const { engine, later } = engineAt();
    const result = await engine.followScouted(LEDGER, 'tile');
    expect(result).toMatchObject({ ok: true, message: 'Following on GitHub in a few seconds', undoToken: expect.stringMatching(/^follow:/) });
    expect((await engine.getPr(LEDGER))?.scouted?.follow).toBe('queued');
    later(UNDO_WINDOW_MS + 1);
    expect((await engine.listScouts())[0]).toMatchObject({ tiles: 3, unseen: 1 });
    const detail = await engine.getPr(LEDGER);
    expect(detail?.scouted).toMatchObject({ followedAt: expect.any(String), tracked: true, active: false, follow: null });
    const unsorted = await engine.getTopic(UNSORTED_TOPIC_ID);
    expect(unsorted?.tiles.some((view) => view.prs.some((pr) => pr.key === LEDGER))).toBe(true);
  });

  it('takes a Follow back inside the window, and nothing changes', async () => {
    const { engine, later } = engineAt();
    const result = await engine.followScouted(LEDGER, 'detail');
    expect(await engine.undo(result.undoToken)).toMatchObject({ ok: true, message: 'Follow undone' });
    later(UNDO_WINDOW_MS + 1);
    expect((await engine.getPr(LEDGER))?.scouted).toMatchObject({ followedAt: null, active: true, follow: null });
    const log = await engine.actionLog(10);
    expect(log.map((entry) => entry.action)).toContain('undo_follow');
  });

  it('parks a Follow made while locked, and follows once it is sent from the lock', async () => {
    const { engine, later } = engineAt({ writesLocked: true });
    expect(await engine.followScouted(LEDGER, 'tile')).toMatchObject({ message: 'Following is pending until you unlock GitHub writes' });
    later(UNDO_WINDOW_MS + 1);
    expect((await engine.getPr(LEDGER))?.scouted?.follow).toBe('pending');
    expect((await engine.githubWrites()).pending.map((write) => write.kind)).toContain('follow');
    await engine.setGitHubWrites(true);
    await engine.sendPendingWrites();
    expect((await engine.getPr(LEDGER))?.scouted).toMatchObject({ followedAt: expect.any(String), follow: null });
  });

  it('dismisses with a reason, locally; a stack stays while one layer is still active', async () => {
    const { engine } = engineAt();
    expect(await engine.dismissScouted(LEDGER, '  not   mine ')).toMatchObject({ ok: true, message: 'Dismissed' });
    expect((await engine.getPr(LEDGER))?.scouted).toMatchObject({ active: false, dismissReason: 'not mine' });
    expect(await engine.dismissScouted(LEDGER, null)).toMatchObject({ ok: false });
    await engine.dismissScouted(HOST, null);
    expect((await engine.getTopic(LOOKOUT))?.tiles.some((view) => view.tile.kind === 'stack')).toBe(true);
    expect((await engine.listScouts())[0]).toMatchObject({ tiles: 3 });
    expect((await engine.githubWrites()).pending.map((write) => write.kind)).toEqual(['follow']);
  });

  it('marks a scouted PR seen in PostPile only', async () => {
    const { engine } = engineAt();
    expect(await engine.markScoutedSeen(LEDGER)).toMatchObject({ ok: true });
    expect((await engine.listScouts())[0]).toMatchObject({ unseen: 1 });
    expect((await engine.getPr(LEDGER))?.scouted?.unseen).toBe(false);
    expect(await engine.markScoutedSeen('acme/app#1')).toMatchObject({ ok: false });
  });

  it("lets an agent's mark_read mark a scouted PR seen in PostPile only, with the usual guards", async () => {
    const { engine } = engineAt();
    const seenThrough = (await engine.getPr(LEDGER))?.seenThrough ?? '';
    expect(await engine.markReadForAgent({ prs: [{ prKey: LEDGER, seenThrough: '0-0' }] }, { client: 'claude-code' })).toMatchObject({ marked: [], refused: [{ prKey: LEDGER }] });

    const result = await engine.markReadForAgent({ prs: [{ prKey: LEDGER, seenThrough }] }, { client: 'claude-code' });

    expect(result).toMatchObject({ marked: [], refused: [], seenLocally: [LEDGER] });
    expect((await engine.getPr(LEDGER))?.scouted?.unseen).toBe(false);
    expect((await engine.githubWrites()).pending.map((write) => write.kind)).toEqual(['follow']);
    expect(await engine.markReadForAgent({ prs: [{ prKey: LEDGER, seenThrough }] }, { client: 'claude-code' })).toMatchObject({ marked: [], skipped: [{ prKey: LEDGER }] });
  });
});
