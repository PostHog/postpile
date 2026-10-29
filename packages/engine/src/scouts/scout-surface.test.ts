import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNDO_WINDOW_MS, type ScoutCandidate } from '@postpile/core';
import { makeEvent, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';
import { FOLLOW_LOOKUP_MS } from './scout-actions.ts';

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
    h.reader.scoutFileLists.set(`acme/app#${number}`, { headOid: `h${number}`, baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
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

  it('finds scouted PRs in a search that asks for scouts, under the scout, by title or scout name', async () => {
    const h = await pulled({ numbers: [1, 2] });

    expect((await h.engine.search('PR 2')).topics).toEqual([]);
    const byTitle = await h.engine.search('PR 2', { allRepos: true, withScouts: true });
    expect(byTitle.topics.map((topic) => topic.topicId)).toEqual(['scout:lookout']);
    expect(byTitle.topics[0]?.tileIds).toEqual(['pr:acme/app#2']);
    const byScout = await h.engine.search('lookout', { allRepos: true, withScouts: true });
    expect(byScout.topics[0]?.tileIds).toEqual(expect.arrayContaining(['pr:acme/app#1', 'pr:acme/app#2']));
  });

  it('reads a scouted PR seen through its scout seen boundary, in the pane as for mark_read', async () => {
    const h = await pulled();
    h.store.events.upsertDerived('acme/app#1', [makeEvent({ id: 'acme/app#1:reply:r1', prKey: 'acme/app#1', kind: 'reply_to_user', ruleLoudness: 'loud', at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString() })]);
    expect((await h.engine.getPr('acme/app#1'))?.unread).toHaveLength(1);

    await h.engine.markScoutedSeen('acme/app#1');

    const pr = await h.engine.getPr('acme/app#1');
    expect(pr?.unread).toEqual([]);
    expect(pr?.whatsNew).toBeNull();
    // GitHub's and the event log's own read state stay as they were.
    expect(h.store.events.listForPr('acme/app#1')[0]?.seenAt).toBeNull();
  });

  it('lets a quit flush wait for a Follow still looking up its PR', async () => {
    const h = await pulled();
    const lookup = h.reader.scoutPrNodeId.bind(h.reader);
    let release: () => void = () => {};
    vi.spyOn(h.reader, 'scoutPrNodeId').mockImplementationOnce(async (ref) => {
      await new Promise<void>((resolve) => (release = resolve));
      return lookup(ref);
    });

    const follow = h.engine.followScouted('acme/app#1', 'tile');
    const flushed = h.engine.flushPendingWrites();
    release();
    await flushed;

    expect((await follow).ok).toBe(true);
    expect(h.writer.calls).toContain('followPr PR_1');
  });

  it('keeps an unseen merged find out of Dealt with until it is opened', async () => {
    const h = makeHarness();
    const merged = makePr({ number: 7, state: 'MERGED', mergedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    h.store.prs.upsert(merged, NOW.toISOString());
    h.store.scoutedPrs.insert({ prKey: merged.key, scoutId: 'lookout', scoutName: 'Lookout', configVersion: 1, reason: 'new folder', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null });

    expect((await h.engine.getTopic('scout:lookout'))?.tiles[0]).toMatchObject({ group: 'open', state: { kind: 'done' }, scout: { unseen: true } });

    await h.engine.markScoutedSeen(merged.key);
    expect((await h.engine.getTopic('scout:lookout'))?.tiles[0]?.group).toBe('dealt_with');
  });

  it('drops a Follow whose lookup never answers after the deadline, so a quit never hangs', async () => {
    const h = await pulled();
    vi.spyOn(h.reader, 'scoutPrNodeId').mockImplementationOnce(() => new Promise(() => {}));

    const follow = h.engine.followScouted('acme/app#1', 'tile');
    const flushed = h.engine.flushPendingWrites();
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await flushed;

    expect(await follow).toMatchObject({ ok: false, message: expect.stringContaining('no answer within 10 s') });
    h.timers.advance(UNDO_WINDOW_MS);
    expect(h.writer.calls).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
    expect(h.store.actionLog.listRecent(5).map((entry) => [entry.action, entry.outcome])).toContainEqual(['follow', 'failed']);
  });

  it('treats a lasting point from a scout chat like Unsorted: no topic to keep it on', async () => {
    const h = await pulled();
    h.runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Skip codegen folders.' } });

    const reply = await h.engine.topicChat('scout:lookout', 'codegen folders are noise');

    expect(reply.lastingPoint).toMatchObject({ topicId: null, text: 'Skip codegen folders.' });
  });

  it('parks a Follow whose subscription never answers after the deadline, so a quit never hangs', async () => {
    const h = await pulled();
    const subscribe = vi.spyOn(h.writer, 'followPr').mockImplementationOnce(() => new Promise(() => {}));
    await h.engine.followScouted('acme/app#1', 'tile');

    const flushed = h.engine.flushPendingWrites();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await flushed;

    expect(h.store.pendingWrites.list()).toMatchObject([{ kind: 'follow', follow: { prKey: 'acme/app#1' }, error: expect.stringContaining('no answer within 10 s') }]);
    expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).toBeNull();
  });

  it('counts a subscription GitHub takes after the deadline as followed, and clears its parked write', async () => {
    const h = await pulled();
    let answer: () => void = () => {};
    const subscribe = vi.spyOn(h.writer, 'followPr').mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    await h.engine.followScouted('acme/app#1', 'tile');
    const flushed = h.engine.flushPendingWrites();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await flushed;
    expect(h.store.pendingWrites.list()).toHaveLength(1);

    answer();

    await vi.waitFor(() => expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).not.toBeNull());
    expect(h.store.pendingWrites.list()).toEqual([]);
    expect(h.store.actionLog.listRecent(5).map((entry) => [entry.action, entry.outcome])).toContainEqual(['follow', 'github']);
  });

  it('never lets a stalled Follow hold the lock\'s queue, and counts it once GitHub answers OK late', async () => {
    const h = await pulled({ writesEnabled: false });
    await h.engine.followScouted('acme/app#1', 'detail');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();
    expect(h.store.pendingWrites.list()).toHaveLength(1);
    await h.engine.setGitHubWrites(true);
    let answer: () => void = () => {};
    const subscribe = vi.spyOn(h.writer, 'followPr').mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));

    const sent = h.engine.sendPendingWrites();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
    h.timers.advance(FOLLOW_LOOKUP_MS);
    await sent;
    expect(h.store.pendingWrites.list()).toMatchObject([{ kind: 'follow', error: expect.stringContaining('no answer within 10 s') }]);

    const before = (await h.engine.livePollStatus()).changeCount;
    answer();
    await vi.waitFor(() => expect(h.store.scoutedPrs.get('acme/app#1')?.followedAt).not.toBeNull());
    expect(h.store.pendingWrites.list()).toEqual([]);
    // The renderer refetches: the live status moved.
    expect((await h.engine.livePollStatus()).changeCount).toBeGreaterThan(before);
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

  it('keeps the lock as it was at the click when writes unlock during the PR lookup', async () => {
    const h = await pulled({ writesEnabled: false });
    const lookup = h.reader.scoutPrNodeId.bind(h.reader);
    vi.spyOn(h.reader, 'scoutPrNodeId').mockImplementation(async (ref) => {
      await h.engine.setGitHubWrites(true);
      return lookup(ref);
    });
    await h.engine.followScouted('acme/app#1', 'tile');
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();

    expect(h.writer.calls.filter((call) => call.startsWith('followPr'))).toEqual([]);
    expect(h.store.pendingWrites.list()).toMatchObject([{ kind: 'follow', follow: { prKey: 'acme/app#1' } }]);
  });

  it('refuses a second Follow while the first one still looks the PR up', async () => {
    const h = await pulled();
    const lookup = h.reader.scoutPrNodeId.bind(h.reader);
    let release: () => void = () => {};
    vi.spyOn(h.reader, 'scoutPrNodeId').mockImplementationOnce(async (ref) => {
      await new Promise<void>((resolve) => (release = resolve));
      return lookup(ref);
    });

    const first = h.engine.followScouted('acme/app#1', 'tile');
    const second = await h.engine.followScouted('acme/app#1', 'detail');
    release();

    expect(second).toMatchObject({ ok: true, message: 'Follow already on its way', undoToken: null });
    expect((await first).undoToken).not.toBeNull();
    h.timers.advance(UNDO_WINDOW_MS);
    await h.engine.flushPendingWrites();
    expect(h.writer.calls.filter((call) => call.startsWith('followPr'))).toEqual(['followPr PR_1']);
  });

  it('says GitHub did not answer, not "no such PR", when the Follow lookup fails', async () => {
    const h = await pulled();
    h.reader.failNodeIdLookup = new Error('GitHub API rate limit exceeded');

    const result = await h.engine.followScouted('acme/app#1', 'tile');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('rate limit exceeded');
    expect(result.message).toContain('retry');
    h.reader.failNodeIdLookup = null;
    expect((await h.engine.followScouted('acme/app#1', 'tile')).ok).toBe(true);
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

  it('never makes a scout stack unread through a context layer, so opening it is enough', async () => {
    const h = makeHarness();
    const bottom = makePr({ number: 5, headRef: 'billing-1', updatedAt: NOW.toISOString() });
    const top = makePr({ number: 6, baseRef: 'billing-1', headRef: 'billing-2', updatedAt: NOW.toISOString() });
    h.store.prs.upsert(bottom, NOW.toISOString());
    h.store.prs.upsert(top, NOW.toISOString());
    const row = { configVersion: 1, seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null };
    h.store.scoutedPrs.insert({ ...row, prKey: top.key, scoutId: 'lookout', scoutName: 'Lookout', reason: 'new folder', pulledAt: '2026-09-02T10:00:00.000Z' });
    // The bottom layer is context only, with a loud reply nobody saw.
    h.store.events.upsertDerived(bottom.key, [makeEvent({ id: `${bottom.key}:reply:r1`, prKey: bottom.key, kind: 'reply_to_user', ruleLoudness: 'loud', at: NOW.toISOString() })]);

    const tile = (await h.engine.getTopic('scout:lookout'))?.tiles[0];
    expect(tile?.tile.members.map((member) => member.provenance.kind)).toEqual(['found', 'found']);
    expect(tile?.state.kind).not.toBe('unread');

    await h.engine.markScoutedSeen(top.key);
    expect((await h.engine.getTopic('scout:lookout'))?.tiles[0]?.scout?.unseen).toBe(false);
  });

  it('counts a scouted PR that was once a pulled-in stack layer, by where the board places it now', async () => {
    const h = makeHarness();
    const pr = makePr({ number: 8, headRef: 'solo', updatedAt: NOW.toISOString() });
    h.store.prs.upsert(pr, NOW.toISOString());
    // Pulled in once as a layer of a stack it has left since: history, not a place.
    h.store.pullIns.put({ prKey: pr.key, anchorPrKey: 'acme/app#99', reason: 'stack layer below #99', pulledAt: '2026-09-01T10:00:00.000Z' });
    h.store.scoutedPrs.insert({ prKey: pr.key, scoutId: 'lookout', scoutName: 'Lookout', configVersion: 1, reason: 'new folder', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null });

    expect((await h.engine.getTopic('scout:lookout'))?.tiles).toHaveLength(1);
    expect((await h.engine.listScouts()).map((scout) => [scout.id, scout.tiles, scout.unseen])).toEqual([['lookout', 1, 1]]);
  });

  it('stops counting a scouted stack once one of its layers is followed', async () => {
    const h = makeHarness();
    const bottom = makePr({ number: 5, headRef: 'billing-1', updatedAt: NOW.toISOString() });
    const top = makePr({ number: 6, baseRef: 'billing-1', headRef: 'billing-2', updatedAt: NOW.toISOString() });
    h.store.prs.upsert(bottom, NOW.toISOString());
    h.store.prs.upsert(top, NOW.toISOString());
    const row = { scoutId: 'lookout', scoutName: 'Lookout', configVersion: 1, reason: 'new folder', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null };
    h.store.scoutedPrs.insert({ ...row, prKey: bottom.key });
    h.store.scoutedPrs.insert({ ...row, prKey: top.key });
    expect((await h.engine.listScouts())[0]).toMatchObject({ tiles: 2, unseen: 2 });

    h.store.scoutedPrs.markFollowed(bottom.key, NOW.toISOString());
    h.store.foundPrs.put({ prKey: bottom.key, via: 'followed', reason: 'followed from scout "Lookout"', foundAt: NOW.toISOString() });

    // The stack shows whole in Unsorted now; its other layer leaves the Scouted count with it.
    expect(await h.engine.listScouts()).toEqual([]);
    expect((await h.engine.getTopic('scout:lookout'))?.tiles ?? []).toEqual([]);
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
    // The PR's own answer says so too: it is not on the Scouted section, though its row is active.
    expect((await h.engine.getPr(top.key))?.scouted).toMatchObject({ active: true, tracked: false, onSection: false });
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
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    h.reader.addStackPr(makePr({ number: 1, headOid: 'h1', updatedAt: candidate(1).updatedAt }));
    h.runner.answer('scout_judge', { judgements: [{ prKey: 'acme/app#1', verdict: 'pull', reason: 'adds billing/' }] });
    await h.engine.sync({});
    h.store.db.prepare('DELETE FROM pr_glance WHERE pr_key = ?').run('acme/app#1');

    expect((await h.engine.retryGlance('acme/app#1')).ok).toBe(true);
    await vi.waitFor(() => expect(h.store.glances.get('acme/app#1')).not.toBeNull());
  });

  it('rewrites a missing or stale scout glance when the PR is looked at', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pp-scout-look-')), 'scouts.md');
    writeFileSync(file, LOOKOUT);
    const h = makeHarness({ scoutsFile: file, catchUpCallsPerDay: 300 });
    h.reader.scoutListings.set('acme/app', [candidate(1)]);
    h.reader.scoutFileLists.set('acme/app#1', { headOid: 'h1', baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: 'billing/main.ts', changeType: 'ADDED' }] });
    h.reader.addStackPr(makePr({ number: 1, headOid: 'h1', updatedAt: candidate(1).updatedAt }));
    h.runner.answer('scout_judge', { judgements: [{ prKey: 'acme/app#1', verdict: 'pull', reason: 'adds billing/' }] });
    await h.engine.sync({});
    h.store.db.prepare('DELETE FROM pr_glance WHERE pr_key = ?').run('acme/app#1');

    expect((await h.engine.refreshGlanceOnLook('acme/app#1')).outcome).not.toBe('current');
    await vi.waitFor(() => expect(h.store.glances.get('acme/app#1')).not.toBeNull());
  });

  it('sizes the Unsorted catch-up for the scouted glances it also writes', async () => {
    const h = makeHarness({ catchUpCallsPerDay: 300 });
    h.store.meta.set('viewer', JSON.stringify({ login: 'alice', teams: [] }));
    const row = { scoutId: 'lookout', scoutName: 'Lookout', reason: 'new folder', configVersion: 1, pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null };
    // More than three glance batches, nothing else in Unsorted: the old cap (3 calls) ran out before the last batch.
    for (let number = 1; number <= 60; number++) {
      const pr = makePr({ number, headRef: `feature-${number}`, updatedAt: NOW.toISOString() });
      h.store.prs.upsert(pr, NOW.toISOString());
      h.store.scoutedPrs.insert({ ...row, prKey: pr.key });
    }

    expect((await h.engine.retryGlance('acme/app#60')).ok).toBe(true);
    await vi.waitFor(() => expect(Array.from({ length: 60 }, (_, index) => h.store.glances.get(`acme/app#${index + 1}`)).every((glance) => glance !== null)).toBe(true));
  });
});

