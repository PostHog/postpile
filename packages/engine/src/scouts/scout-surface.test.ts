import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNDO_WINDOW_MS, type ScoutCandidate } from '@postpile/core';
import { makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';

const LOOKOUT = '## Lookout\nrepos: acme/app\n\nNew top-level folders.\n';

function candidate(number: number, overrides: Partial<ScoutCandidate> = {}): ScoutCandidate {
  return {
    key: `acme/app#${number}`,
    nodeId: `PR_${number}`,
    title: `PR ${number}`,
    body: '',
    author: 'carol',
    assignees: [],
    isDraft: false,
    state: 'OPEN',
    headOid: `h${number}`,
    baseOid: 'base1',
    updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    mergedAt: null,
    ...overrides,
  };
}

/** A sync that pulls in #1 (and #2 when asked) through the Lookout scout. */
async function pulled(options: { writesEnabled?: boolean; numbers?: number[] } = {}): Promise<Harness> {
  const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-surface-')), 'scouts.md');
  writeFileSync(file, LOOKOUT);
  const h = makeHarness({ scoutsFile: file, writesEnabled: options.writesEnabled ?? true });
  const numbers = options.numbers ?? [1];
  h.reader.scoutListings.set('acme/app', numbers.map((number) => candidate(number)));
  for (const number of numbers) {
    h.reader.scoutFileLists.set(`acme/app#${number}`, { headOid: `h${number}`, baseOid: 'base1', files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    h.reader.addStackPr(makePr({ number, headOid: `h${number}`, updatedAt: candidate(number).updatedAt }));
  }
  h.runner.answer('scout_judge', { judgements: numbers.map((number) => ({ prKey: `acme/app#${number}`, verdict: 'pull', reason: `adds billing/ (#${number})` })) });
  await h.engine.sync({});
  return h;
}

describe('the Scouted section', () => {
  it('lists one row per scout with its tiles and unseen count, outside every topic and count', async () => {
    const h = await pulled();

    expect(await h.engine.listScouts()).toEqual([{ id: 'lookout', topicId: 'scout:lookout', name: 'Lookout', tiles: 1, unseen: 1 }]);
    const detail = await h.engine.getTopic('scout:lookout');
    expect(detail?.scout).toMatchObject({ id: 'lookout', tiles: 1 });
    expect(detail?.tiles).toHaveLength(1);
    expect(detail?.tiles[0]).toMatchObject({
      scout: { scoutId: 'lookout', scoutName: 'Lookout', reason: 'adds billing/ (#1)', unseen: true, prKeys: ['acme/app#1'], follow: null },
      state: { kind: 'open' },
    });
    expect(detail?.tiles[0]?.prs[0]?.provenance).toMatchObject({ kind: 'found', via: 'scouted' });
    expect(detail?.yourMoves).toEqual([]);
    // Nothing of it counts anywhere else.
    expect(await h.engine.listTopics()).toEqual([]);
    expect((await h.engine.getTopic('unsorted'))?.tiles).toEqual([]);
  });

  it('reads seen once opened, and unseen again after new activity', async () => {
    const h = await pulled();

    expect((await h.engine.markScoutedSeen('acme/app#1')).ok).toBe(true);
    expect((await h.engine.listScouts())[0]?.unseen).toBe(0);
    expect(h.store.userPrStates.get('acme/app#1')?.handledAt ?? null).toBeNull();

    h.store.scoutedPrs.markSeen('acme/app#1', '2026-01-01T00:00:00.000Z');
    expect((await h.engine.listScouts())[0]?.unseen).toBe(0);
  });

  it('says in the PR pane who scouted it and why', async () => {
    const h = await pulled();
    const pr = await h.engine.getPr('acme/app#1');
    expect(pr?.scouted).toMatchObject({ scoutName: 'Lookout', reason: 'adds billing/ (#1)', active: true, tracked: false, unseen: true });
    expect(pr?.topicId).toBe('scout:lookout');
    expect(pr?.tileIds).toEqual(['pr:acme/app#1']);
  });

  it('follows on GitHub after the undo window, then tracks the PR like a found one', async () => {
    const h = await pulled();

    const result = await h.engine.followScouted('acme/app#1', 'tile');
    expect(result).toMatchObject({ ok: true, message: 'Following on GitHub in a few seconds' });
    expect(result.undoToken).toMatch(/^follow:/);
    expect((await h.engine.getTopic('scout:lookout'))?.tiles[0]?.scout?.follow).toBe('queued');
    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).toBeNull();

    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(h.writer.calls).toContain('followPr PR_1');
    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).toBe(NOW.toISOString());
    expect((await h.engine.listScouts())[0]?.tiles).toBe(0);
    expect((await h.engine.getTopic('unsorted'))?.tiles[0]?.prs[0]?.provenance).toMatchObject({ kind: 'found', via: 'followed' });

    // The next sync's finder list keeps it.
    await h.engine.sync({});
    expect(h.store.foundPrs.listAll().get('acme/app#1')).toMatchObject({ via: 'followed', reason: 'followed from scout "Lookout"' });
  });

  it('takes a Follow back inside its window without a GitHub write', async () => {
    const h = await pulled();
    const result = await h.engine.followScouted('acme/app#1', 'tile');

    expect(await h.engine.undo(result.undoToken)).toMatchObject({ ok: true, message: 'Follow undone' });
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(h.writer.calls.filter((call) => call.startsWith('followPr'))).toEqual([]);
    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).toBeNull();
    expect(h.store.actionLog.listRecent(10).map((entry) => [entry.action, entry.outcome])).toContainEqual(['undo_follow', 'local']);
  });

  it('waits in the lock while writes are locked, and follows once sent from the footer', async () => {
    const h = await pulled({ writesEnabled: false });
    await h.engine.followScouted('acme/app#1', 'detail');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(h.writer.calls).toEqual([]);
    expect(h.store.pendingWrites.list()).toMatchObject([{ kind: 'follow', follow: { prKey: 'acme/app#1', subjectId: 'PR_1' } }]);
    expect((await h.engine.getTopic('scout:lookout'))?.tiles[0]?.scout?.follow).toBe('pending');

    await h.engine.setGitHubWrites(true);
    await h.engine.sendPendingWrites();

    expect(h.writer.calls).toContain('followPr PR_1');
    expect(h.store.pendingWrites.list()).toEqual([]);
    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).not.toBeNull();
  });

  it('keeps a failed Follow pending as failed, never followed', async () => {
    const h = await pulled();
    h.writer.failFollow = true;
    await h.engine.followScouted('acme/app#1', 'tile');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).toBeNull();
    expect((await h.engine.getPr('acme/app#1'))?.scouted?.follow).toBe('failed');
  });

  it('dismisses with a reason, off the section for good', async () => {
    const h = await pulled({ numbers: [1, 2] });

    expect(await h.engine.dismissScouted('acme/app#1', '  not   our area ')).toMatchObject({ ok: true });
    expect(h.store.scoutedPrs.get('acme/app#1')).toMatchObject({ dismissReason: 'not our area' });
    expect((await h.engine.listScouts())[0]).toMatchObject({ tiles: 1 });
    expect((await h.engine.dismissScouted('acme/app#1', null)).ok).toBe(false);
  });

  it('shows a scouted PR that reached the inbox in its normal tile instead', async () => {
    const h = await pulled();
    const pr = makePr({ number: 1, headOid: 'h1', updatedAt: NOW.toISOString() });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.etag = 'etag-2';
    await h.engine.sync({});

    expect((await h.engine.listScouts())[0]?.tiles).toBe(0);
    expect((await h.engine.getTopic('unsorted'))?.tiles[0]?.prs[0]?.provenance.kind).toBe('pinged');
    expect((await h.engine.getPr('acme/app#1'))?.scouted).toMatchObject({ tracked: true });
  });

  it("lets an agent's mark_read mark a scouted PR seen in PostPile only, with the usual guards", async () => {
    const h = await pulled();
    const seenThrough = (await h.engine.getPr('acme/app#1'))!.seenThrough;

    const stale = await h.engine.markReadForAgent({ prs: [{ prKey: 'acme/app#1', seenThrough: '999999-x' }] }, { client: 'claude-code' });
    expect(stale.refused).toHaveLength(1);

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: 'acme/app#1', seenThrough }] }, { client: 'claude-code' });
    expect(result).toMatchObject({ marked: [], seenLocally: ['acme/app#1'], refused: [], skipped: [] });
    expect(h.writer.calls).toEqual([]);
    expect((await h.engine.listScouts())[0]?.unseen).toBe(0);

    const again = await h.engine.markReadForAgent({ prs: [{ prKey: 'acme/app#1', seenThrough }] }, { client: 'claude-code' });
    expect(again.skipped).toHaveLength(1);
  });

  it('shows a stack outside the inbox whole with the scout that pulled a layer first', async () => {
    const h = makeHarness();
    const bottom = makePr({ number: 5, headRef: 'billing-1', updatedAt: NOW.toISOString() });
    const top = makePr({ number: 6, baseRef: 'billing-1', headRef: 'billing-2', updatedAt: NOW.toISOString() });
    h.store.prs.upsert(bottom, NOW.toISOString());
    h.store.prs.upsert(top, NOW.toISOString());
    const row = { configVersion: 1, seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null };
    h.store.scoutedPrs.insert({ ...row, prKey: top.key, scoutId: 'lookout', scoutName: 'Lookout', reason: 'new folder', pulledAt: '2026-09-02T10:00:00.000Z' });
    h.store.scoutedPrs.insert({ ...row, prKey: bottom.key, scoutId: 'billing', scoutName: 'Billing', reason: 'invoices', pulledAt: '2026-09-02T11:00:00.000Z' });

    // The sidebar counts PRs from headers, each under the scout that pulled it; the section shows the stack whole.
    const scouts = await h.engine.listScouts();
    expect(scouts.map((scout) => [scout.id, scout.tiles])).toEqual([
      ['lookout', 1],
      ['billing', 1],
    ]);
    expect((await h.engine.getTopic('scout:billing'))?.tiles).toEqual([]);
    const tiles = (await h.engine.getTopic('scout:lookout'))?.tiles ?? [];
    expect(tiles.map((view) => view.tile.members.map((member) => member.prKey))).toEqual([[bottom.key, top.key]]);
    // The owning scout speaks for the stack, not the scout of its bottom layer.
    expect(tiles[0]?.scout).toMatchObject({ scoutId: 'lookout', scoutName: 'Lookout', reason: 'new folder' });
  });

  it('leaves a scouted stack layer to the normal topic when another layer is tracked', async () => {
    const h = makeHarness();
    const bottom = makePr({ number: 5, headRef: 'billing-1', updatedAt: NOW.toISOString() });
    const top = makePr({ number: 6, baseRef: 'billing-1', headRef: 'billing-2', updatedAt: NOW.toISOString() });
    h.reader.addPr(bottom, makeThreadFor(bottom));
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.scoutedPrs.insert({ prKey: top.key, scoutId: 'lookout', scoutName: 'Lookout', configVersion: 1, reason: 'new folder', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null });

    // Not in scouts.md and nothing on its section: no row at all.
    expect(await h.engine.listScouts()).toEqual([]);
    const unsorted = (await h.engine.getTopic('unsorted'))?.tiles ?? [];
    expect(unsorted.flatMap((view) => view.tile.members.map((member) => member.prKey))).toEqual([bottom.key, top.key]);
  });

  it('refuses tile actions on a scout tile: nothing there is the user\'s to mark read', async () => {
    const h = await pulled();
    const result = await h.engine.markRead('pr:acme/app#1');
    expect(result.ok).toBe(false);
    expect(h.store.userPrStates.get('acme/app#1')?.handledAt ?? null).toBeNull();
  });

  it("refuses an agent's old seen_through once the PR's description changed since", async () => {
    const h = await pulled();
    const seenThrough = (await h.engine.getPr('acme/app#1'))!.seenThrough;
    const edited = makePr({ number: 1, headOid: 'h1', body: 'edited', updatedAt: new Date(NOW.getTime() + 60_000).toISOString() });
    h.store.prs.upsert(edited, NOW.toISOString());

    const result = await h.engine.markReadForAgent({ prs: [{ prKey: 'acme/app#1', seenThrough }] }, { client: 'claude-code' });
    expect(result.refused).toHaveLength(1);
    expect(result.seenLocally ?? []).toEqual([]);
  });

  it('retries a failed scout glance through the catch-up, like any glance', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-retry-')), 'scouts.md');
    writeFileSync(file, LOOKOUT);
    const h = makeHarness({ scoutsFile: file, catchUpCallsPerDay: 300 });
    h.reader.scoutListings.set('acme/app', [candidate(1)]);
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base1', files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    h.reader.addStackPr(makePr({ number: 1, headOid: 'h1', updatedAt: candidate(1).updatedAt }));
    h.runner.answer('scout_judge', { judgements: [{ prKey: 'acme/app#1', verdict: 'pull', reason: 'adds billing/' }] });
    await h.engine.sync({});
    h.store.db.prepare('DELETE FROM pr_glance WHERE pr_key = ?').run('acme/app#1');

    expect((await h.engine.retryGlance('acme/app#1')).ok).toBe(true);
    await vi.waitFor(() => expect(h.store.glances.get('acme/app#1')).not.toBeNull());
  });
});

