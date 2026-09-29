import { describe, expect, it, vi } from 'vitest';
import type {
  ActionLogEntry,
  ActionResult,
  ChatReply,
  GitHubWritesChange,
  InstructionsChatReply,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  MemorySources,
  NotificationDebugRow,
  OpenedReadResult,
  QuietReadView,
  GitHubWritesStatus,
  InboxCleanupView,
  PrDetail,
  FinishedTopic,
  RepoOverview,
  SearchResult,
  TopicDetail,
  TopicListItem,
} from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const setTile = encodeURIComponent('set:turbo-cache');

const TOKEN = 'test-token';

interface TestApp {
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** Wraps the app so every request carries the token. */
function appWithFake(engine: FakeEngine = new FakeEngine({ syncStepMs: 0 })): TestApp {
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 });
  return {
    request: async (path, init = {}) => {
      const headers = { ...(init.headers as Record<string, string> | undefined), [TOKEN_HEADER]: TOKEN };
      return app.request(path, { ...init, headers });
    },
  };
}

async function post<T>(app: TestApp, path: string, body: unknown = {}): Promise<{ status: number; json: T }> {
  const res = await app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return { status: res.status, json: (await res.json()) as T };
}

/** Every PR row of every sample topic. */
async function allRows(app: TestApp): Promise<TopicDetail['tiles'][number]['prs']> {
  const topics = (await (await app.request('/api/topics')).json()) as TopicListItem[];
  const details = await Promise.all(topics.map(async (item) => (await (await app.request(`/api/topics/${item.topic.id}`)).json()) as TopicDetail));
  return details.flatMap((detail) => detail.tiles.flatMap((tile) => tile.prs));
}

describe('server routes over the fake engine', () => {
  it('retries a failed glance: queued, writing, then ready', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, catchUpStepMs: 5 }));
    // The sample catch-up starts once a UI reads the live status.
    await app.request('/api/live');
    const failed = (await allRows(app)).find((row) => row.glanceState === 'failed');
    expect(failed).toBeDefined();
    const path = `/api/prs/${failed!.key.replace('#', '/')}`;

    const res = await post<ActionResult>(app, `${path}/glance/retry`);

    expect(res.json).toMatchObject({ ok: true, message: 'Writing the glance…' });
    expect(((await (await app.request(path)).json()) as PrDetail).glanceState).toBe('queued');
    await vi.waitFor(async () => expect(((await (await app.request(path)).json()) as PrDetail).glanceState).toBe('ready'));
  });

  it('shows the inbox cleanup on sample data, parks it while locked and starts fresh', async () => {
    const app = appWithFake();
    const view = (await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView;
    expect(view).toMatchObject({ unreadOlderThan14: 3, unreadOlderThan30: 1, look: 'banner', baseline: null, pendingCutoff: null });

    const parked = await post<{ ok: boolean; message: string }>(app, '/api/inbox-cleanup/mark-read', { olderThanDays: 14 });
    expect(parked.json.message).toMatch(/^Pending/);
    const writes = (await (await app.request('/api/github-writes')).json()) as GitHubWritesStatus;
    expect(writes.pending).toEqual([expect.objectContaining({ kind: 'mark_all_read_before', origin: 'cleanup', threadCount: 3 })]);
    expect(((await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView).look).toBe('line');

    await post(app, '/api/github-writes', { enabled: true });
    await post(app, '/api/github-writes/pending/send');
    expect(((await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView).unreadOlderThan14).toBe(0);

    expect((await post(app, '/api/inbox-cleanup/mark-read', { olderThanDays: 7 })).status).toBe(400);
    await post(app, '/api/inbox-cleanup/start-fresh');
    expect(((await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView).baseline).not.toBeNull();
    await app.request('/api/inbox-cleanup/start-fresh', { method: 'DELETE' });
    expect(((await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView).baseline).toBeNull();
  });

  it('lists repos, keeps the topics of the chosen repo, labels other repos and sets a repo quiet', async () => {
    const app = appWithFake();
    const repos = (await (await app.request('/api/repos')).json()) as RepoOverview;
    expect(repos.scope).toBeNull();
    expect(repos.repos.map((entry) => [entry.repo, entry.topics])).toEqual([
      ['acme/app', 6],
      ['acme/desktop', 1],
      ['acme/infra', 1],
      ['acme/python-sdk', 1],
    ]);

    // All repos: the Depot topic labels its tile outside its main repo.
    const depot = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    const tileLabels = depot.tiles.flatMap((view) => (view.repoLabel ? [view.repoLabel] : []));
    expect(tileLabels).toEqual(['infra']);

    const scoped = await post<RepoOverview>(app, '/api/repos/scope', { repo: 'acme/infra' });
    expect(scoped.json.scope).toBe('acme/infra');
    expect(scoped.json.repos.find((entry) => entry.selected)?.repo).toBe('acme/infra');
    const topics = (await (await app.request('/api/topics')).json()) as TopicListItem[];
    expect(topics.map((item) => item.topic.id)).toEqual(['topic-depot']);
    // The opened topic keeps every tile; now the acme/app ones carry the label.
    const narrowed = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(narrowed.tiles.length).toBe(depot.tiles.length);
    expect(narrowed.tiles.find((view) => view.prs.some((pr) => pr.key === 'acme/infra#1915'))?.repoLabel).toBeNull();
    expect(narrowed.tiles.find((view) => view.tile.kind === 'stack')?.repoLabel).toBe('app');

    const quiet = await post<RepoOverview>(app, '/api/repos/quiet', { repo: 'acme/desktop', quiet: true });
    expect(quiet.json.repos.find((entry) => entry.repo === 'acme/desktop')?.quiet).toBe(true);
    const detail = (await (await app.request('/api/topics/topic-desktop-release')).json()) as TopicDetail;
    expect(detail.tiles[0]?.quietRepo).toBe(true);

    expect((await post(app, '/api/repos/quiet', { repo: 'not a repo', quiet: true })).status).toBe(400);
    expect((await post(app, '/api/repos/scope', { repos: ['acme/infra'] })).status).toBe(400);
    expect((await post<RepoOverview>(app, '/api/repos/scope', { repo: null })).json.scope).toBeNull();
  });

  it('lists topics grouped by whether they need the user', async () => {
    const res = await appWithFake().request('/api/topics');
    const topics = (await res.json()) as TopicListItem[];
    const depot = topics.find((item) => item.topic.id === 'topic-depot');
    expect(depot?.group).toBe('needs_you');
    expect(depot?.unreadTiles).toBe(3);
    expect(topics.find((item) => item.topic.id === 'topic-frontend-build')?.group).toBe('quiet');
  });

  it('lists finished topics apart from the sidebar topics, and opens one like any topic', async () => {
    const app = appWithFake();

    const finished = (await (await app.request('/api/topics/finished')).json()) as FinishedTopic[];
    const topics = (await (await app.request('/api/topics')).json()) as TopicListItem[];

    expect(finished.map((topic) => `${topic.id} ${topic.prCount}`)).toEqual(['topic-cache-warmer 1']);
    expect(topics.map((item) => item.topic.id)).not.toContain('topic-cache-warmer');
    const detail = (await (await app.request('/api/topics/topic-cache-warmer')).json()) as TopicDetail;
    expect(detail.topic.status).toBe('retired');
    expect(detail.tiles.map((view) => view.tile.id)).toEqual(['pr:acme/app#1840']);
  });

  it('rechecks a memory line and validates the body', async () => {
    const app = createApp(new FakeEngine({ recheckDelayMs: 0 }), TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 });
    const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };
    const body = { factId: 'fact-rowan-drives', topicId: null, text: 'rowan drives it', target: { kind: 'fact', factId: 'fact-rowan-drives' } };
    const res = await app.request('/api/memory/recheck', { method: 'POST', headers, body: JSON.stringify(body) });
    expect(await res.json()).toMatchObject({ status: 'answered', outcome: 'holds' });
    const bad = await app.request('/api/memory/recheck', { method: 'POST', headers, body: JSON.stringify({ text: '' }) });
    expect(bad.status).toBe(400);
  });

  it('lists stored notification threads newest first with where they landed', async () => {
    const app = appWithFake();
    const rows = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    const times = rows.map((row) => row.thread.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
    const kinds = new Set(rows.map((row) => row.landing.kind));
    expect(kinds).toEqual(new Set(['tile', 'not_pr', 'pr_not_synced', 'topic_hidden']));
    // The retired sample topic lists no tiles, so its thread lands nowhere visible.
    expect(rows.find((row) => row.prKey === 'acme/app#1840')?.landing).toMatchObject({ kind: 'topic_hidden', topicId: 'topic-cache-warmer' });
    const depot = rows.find((row) => row.prKey === 'acme/app#1902');
    expect(depot?.landing).toMatchObject({ kind: 'tile', topicId: 'topic-depot', tileId: 'stack:acme/app#1851' });
    expect(depot?.recentEvents.length).toBeGreaterThan(0);

    const limited = (await (await app.request('/api/debug/notifications?limit=2')).json()) as NotificationDebugRow[];
    expect(limited).toHaveLength(2);
    expect((await app.request('/api/debug/notifications?limit=0')).status).toBe(400);
  });

  it('lists the last 7 days of quiet mark-reads, newest first, and shows them and the ping decisions on debug rows', async () => {
    const app = appWithFake();
    const quiet = (await (await app.request('/api/handled-quietly')).json()) as QuietReadView[];
    expect(quiet.map((item) => item.prKey)).toEqual(['acme/app#1904', 'acme/app#1911', 'acme/app#1899', 'acme/app#1960', 'acme/app#1921', 'acme/app#1963']);
    expect(quiet[0]).toMatchObject({ repo: 'acme/app', number: 1904, title: 'Hash Turbo inputs by lockfile only', reason: 'bots', bots: ['trunk-io[bot]', 'CI'] });
    expect(quiet[1]).toMatchObject({ number: 1911, reason: 'approved', bots: [] });

    const rows = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    expect(rows.find((row) => row.prKey === 'acme/app#1904')?.lastAction).toMatchObject({ origin: 'quiet', outcome: 'github' });
    expect(rows.find((row) => row.prKey === 'acme/app#1902')?.pingDecisions.map((decision) => decision.source)).toEqual(['agent', 'rules']);
  });

  it('marks an opened PR read in memory only when nothing is asked and writes are unlocked', async () => {
    const app = appWithFake();
    const topics = (await (await app.request('/api/topics')).json()) as TopicListItem[];
    const details = await Promise.all(topics.map(async (item) => (await (await app.request(`/api/topics/${item.topic.id}`)).json()) as TopicDetail));
    const rows = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    const unreadKeys = new Set(rows.filter((row) => row.thread.unread).map((row) => row.prKey));
    const views = details.flatMap((detail) => detail.tiles).filter((view) => view.tile.members.length === 1 && unreadKeys.has(view.tile.members[0]!.prKey));
    const done = views.find((view) => view.afterRead.done && view.state.kind !== 'snoozed')!;
    const yours = views.find((view) => !view.afterRead.done)!;
    const doneKey = done.tile.members[0]!.prKey;
    const opened = (key: string) => post<OpenedReadResult>(app, `/api/prs/${key.replace('#', '/')}/opened`);

    expect((await opened(doneKey)).json).toEqual({ marked: false });
    await post(app, '/api/github-writes', { enabled: true });
    expect((await opened(yours.tile.members[0]!.prKey)).json).toEqual({ marked: false });
    expect((await opened(doneKey)).json).toEqual({ marked: true });
    expect((await opened(doneKey)).json).toEqual({ marked: false });
    // Handled in PostPile too: the tile is done now, not just read.
    const topic = (await (await app.request(`/api/topics/${done.tile.topicId}`)).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === done.tile.id)?.state.kind).toBe('done');

    const quiet = (await (await app.request('/api/handled-quietly')).json()) as QuietReadView[];
    expect(quiet[0]).toMatchObject({ prKey: doneKey, reason: 'opened' });
  });

  it('does not mark anything read when the debug list is read', async () => {
    const app = appWithFake();
    const before = (await (await app.request('/api/topics')).json()) as TopicListItem[];
    await app.request('/api/debug/notifications');
    const after = (await (await app.request('/api/topics')).json()) as TopicListItem[];
    expect(after.map((item) => item.unreadTiles)).toEqual(before.map((item) => item.unreadTiles));
  });

  it('filters topics and tiles by a search query', async () => {
    const app = appWithFake();
    const res = await app.request(`/api/search?q=${encodeURIComponent('turbo #1921')}`);
    const result = (await res.json()) as SearchResult;
    expect(result.topics).toEqual([{ topicId: 'topic-depot', tileIds: ['set:turbo-cache'], prKeys: ['acme/app#1921'] }]);
    const empty = (await (await app.request('/api/search')).json()) as SearchResult;
    expect(empty.topics).toEqual([]);
  });

  it('returns a topic with tiles and says why a tile is unread', async () => {
    const res = await appWithFake().request('/api/topics/topic-depot');
    const detail = (await res.json()) as TopicDetail;
    const set = detail.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.state.kind).toBe('unread');
    expect(set?.state.unreadBecause[0]?.prKey).toBe('acme/app#1907');
    expect(detail.tiles.find((view) => view.tile.id === 'pr:acme/app#1899')?.state.kind).toBe('done');
    expect(detail.pendingProposals).toEqual([]);
  });

  it('answers 404 for unknown topics and PRs', async () => {
    const app = appWithFake();
    expect((await app.request('/api/topics/nope')).status).toBe(404);
    expect((await app.request('/api/prs/acme/app/1')).status).toBe(404);
  });

  it('returns a PR with glance and events', async () => {
    const res = await appWithFake().request('/api/prs/acme/app/1902');
    const detail = (await res.json()) as PrDetail;
    expect(detail.glance?.verdict).toBe('LOOK_CLOSER');
    // One unit per PR: #1902 is a stack layer, so it is in the stack tile only.
    expect(detail.tileIds).toEqual(['stack:acme/app#1851']);
    expect(detail.events[0]?.display).toBe('loud');
  });

  it('rejects bad input with 400', async () => {
    const app = appWithFake();
    expect((await app.request('/api/prs/acme/app/abc')).status).toBe(400);
    expect((await post(app, `/api/tiles/${setTile}/snooze`, { condition: { kind: 'someday' } })).status).toBe(400);
    const res = await app.request('/api/feedback', { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
  });

  it('syncs with or without options and rejects bad ones', async () => {
    const app = appWithFake();
    expect((await app.request('/api/sync', { method: 'POST' })).status).toBe(200);
    expect((await post(app, '/api/sync', { maxPrs: 5, maxAgentCalls: 0 })).status).toBe(200);
    expect((await post(app, '/api/sync', { maxPrs: 0 })).status).toBe(400);
  });

  it('marks a tile read and undoes it', async () => {
    const app = appWithFake();
    await post(app, '/api/github-writes', { enabled: true });
    const marked = await post<ActionResult>(app, `/api/tiles/${setTile}/mark-read`);
    expect(marked.json.undoToken).toBeTruthy();
    let topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    // Read, but reviews are still asked of you there: it stays open, not done.
    expect(topic.tiles.find((view) => view.tile.id === 'set:turbo-cache')?.state.kind).toBe('open');

    const undone = await post<ActionResult>(app, '/api/undo', { undoToken: marked.json.undoToken });
    expect(undone.json.ok).toBe(true);
    topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'set:turbo-cache')?.state.kind).toBe('unread');
  });

  it('marks one PR of a tile read from the detail pane, leaving the other PRs as they were', async () => {
    const app = appWithFake();
    await post(app, '/api/github-writes', { enabled: true });
    const setView = async () =>
      ((await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail).tiles.find((view) => view.tile.id === 'set:turbo-cache');
    const unseen = async () => Object.fromEntries((await setView())?.prs.map((pr) => [pr.key, pr.unseenLoudEvents]) ?? []);
    const before = await unseen();
    expect(before['acme/app#1907']).toBeGreaterThan(0);

    const marked = await post<ActionResult>(app, `/api/tiles/${setTile}/prs/acme/app/1907/mark-read`);

    expect(marked.json.ok).toBe(true);
    expect(await unseen()).toEqual({ ...before, 'acme/app#1907': 0 });
    expect((await post(app, `/api/tiles/${setTile}/prs/acme/app/0/mark-read`)).status).toBe(400);
  });

  it('refuses to approve while GitHub writes are off, approves once the lock is open', async () => {
    const app = appWithFake();
    const refused = await post<ActionResult>(app, '/api/prs/acme/app/1911/approve');
    expect(refused.json.ok).toBe(false);
    const change = await post<GitHubWritesChange>(app, '/api/github-writes', { enabled: true });
    expect(change.json.status.enabled).toBe(true);
    expect(await (await app.request('/api/github-writes')).json()).toEqual({ enabled: true, forcedOffReason: null, pending: [] });
    const res = await post<ActionResult>(app, '/api/prs/acme/app/1911/approve');
    expect(res.json.ok).toBe(true);
    const detail = (await (await app.request('/api/prs/acme/app/1911')).json()) as PrDetail;
    expect(detail.userState?.approvedAt).toBeTruthy();
  });

  it('marks a thread read from the debug view and logs it', async () => {
    const app = appWithFake();
    const rows = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    const row = rows.find((candidate) => candidate.prKey === 'acme/app#1902' && candidate.thread.unread)!;
    const marked = await post<ActionResult>(app, `/api/notifications/${encodeURIComponent(row.thread.id)}/mark-read`);
    expect(marked.json.message).toMatch(/pending until you unlock/);

    const log = (await (await app.request('/api/debug/actions')).json()) as ActionLogEntry[];
    // The sample "Handled quietly" rows come first in time, so they sit below the click.
    expect(log.filter((entry) => entry.origin !== 'quiet').map((entry) => [entry.action, entry.origin, entry.outcome])).toEqual([
      ['mark_read', 'debug', 'queued'],
    ]);
    const after = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    expect(after.find((candidate) => candidate.thread.id === row.thread.id)?.lastAction?.action).toBe('mark_read');
    expect((await app.request('/api/debug/actions?limit=0')).status).toBe(400);
  });

  it('snoozes and unsnoozes a tile', async () => {
    const app = appWithFake();
    const tile = encodeURIComponent('pr:acme/app#1822');
    await post(app, '/api/github-writes', { enabled: true });
    await post(app, `/api/tiles/${tile}/mark-read`);
    await post(app, `/api/tiles/${tile}/snooze`, { condition: { kind: 'new_push' } });
    let topic = (await (await app.request('/api/topics/topic-ci-tests')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'pr:acme/app#1822')?.state.kind).toBe('snoozed');
    await app.request(`/api/tiles/${tile}/snooze`, { method: 'DELETE' });
    topic = (await (await app.request('/api/topics/topic-ci-tests')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'pr:acme/app#1822')?.state.kind).not.toBe('snoozed');
  });

  it('drops a set member on "not related" feedback', async () => {
    const app = appWithFake();
    await post(app, '/api/feedback', { kind: 'not_related', tileId: 'set:turbo-cache', prKey: 'acme/app#1855' });
    const topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    const set = topic.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.prs.map((pr) => pr.key)).toEqual(['acme/app#1904', 'acme/app#1907', 'acme/app#1921']);
    expect(set?.tile.stacks).toEqual([{ id: 'stack:acme/app#1904', prKeys: ['acme/app#1904', 'acme/app#1907'] }]);
  });

  it('turns a lasting chat point into tailoring once confirmed', async () => {
    const app = appWithFake();
    const reply = await post<ChatReply>(app, `/api/tiles/${setTile}/chat`, { message: 'Always flag Turbo version bumps here' });
    expect(reply.json.lastingPoint).toMatchObject({ topicId: 'topic-depot', text: 'Always flag Turbo version bumps here' });
    const history = (await (await app.request(`/api/tiles/${setTile}/chat`)).json()) as unknown[];
    expect(history).toHaveLength(2);

    await post(app, '/api/topics/topic-depot/tailoring', { text: 'Always flag Turbo version bumps here', keep: true });
    const topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.topic.tailoring).toContain('Always flag Turbo version bumps here');
  });

  it('turns a point the user keeps for all topics into an instructions proposal and saves it on accept', async () => {
    const app = appWithFake();
    const reply = await post<ChatReply>(app, `/api/tiles/${setTile}/chat`, { message: 'From now on flag every CI timeout change' });
    const sourceChatMessageId = reply.json.lastingPoint?.sourceChatMessageId;
    const proposed = await post<InstructionsProposalReply>(app, '/api/instructions/proposals', { sourceChatMessageId });
    const proposal = proposed.json.proposal;
    expect(proposal?.text).toContain('- From now on flag every CI timeout change');
    expect(proposal?.sourceChatMessageId).toBe(sourceChatMessageId);

    const saved = await post<InstructionsSaveResult>(app, '/api/instructions', { proposal, text: proposal?.text });
    expect(saved.json).toMatchObject({ ok: true, savedVersion: 4 });
    expect(saved.json.message).toContain('Will refresh 2 topic dossiers');
    const view = (await (await app.request('/api/instructions')).json()) as InstructionsView;
    expect(view.versions[0]).toMatchObject({ version: 4, origin: 'chat', sourceText: 'From now on flag every CI timeout change' });

    const stale = await post<InstructionsSaveResult>(app, '/api/instructions', { proposal, text: proposal?.text });
    expect(stale.json.ok).toBe(false);
    expect(stale.json.rebased?.baseVersion).toBe(4);
  });

  it('proposes from the general instructions chat', async () => {
    const app = appWithFake();
    const chat = await post<InstructionsChatReply>(app, '/api/instructions/chat', { message: 'Skip docs-only PRs' });
    expect(chat.json.proposal?.summary).toBe('Added: Skip docs-only PRs');
    const history = (await (await app.request('/api/instructions/chat')).json()) as unknown[];
    expect(history.length).toBeGreaterThanOrEqual(4);
  });

  it('answers "Why?" for facts and dossier lines', async () => {
    const app = appWithFake();
    const fact = (await (await app.request('/api/memory/sources?fact=fact-1902-status')).json()) as MemorySources;
    expect(fact.check).toMatchObject({ state: 'stale', reason: 'head_moved' });
    const line = (await (await app.request('/api/memory/sources?topic=topic-depot&version=3&path=openQuestions%5B0%5D')).json()) as MemorySources;
    expect(line.claim).toBe('Does the Turbo cache warm-up need a feature flag?');
    expect(line.sources.some((source) => source.who === 'lyra' && !source.missing)).toBe(true);
    expect((await app.request('/api/memory/sources?fact=nope')).status).toBe(404);
    expect((await app.request('/api/memory/sources?topic=topic-depot')).status).toBe(400);
  });

  it('drafts an ask and keeps the sent comment local', async () => {
    const app = appWithFake();
    const draft = await post<{ body: string }>(app, '/api/prs/acme/app/1915/draft-ask', { person: 'rowan', intent: 'why not the org secret?' });
    expect(draft.json.body).toMatch(/^@rowan why not the org secret\?/);
    await post(app, '/api/github-writes', { enabled: true });
    const sent = await post<ActionResult>(app, '/api/prs/acme/app/1915/comment', { body: draft.json.body });
    expect(sent.json.message).toContain('nothing sent to GitHub');
  });

  it('unmutes an event and decides a proposal', async () => {
    const app = appWithFake();
    const pr = (await (await app.request('/api/prs/acme/app/1899')).json()) as PrDetail;
    const muted = pr.events.find((view) => view.display === 'muted');
    expect(muted).toBeDefined();
    await post(app, `/api/events/${encodeURIComponent(muted?.event.id ?? '')}/unmute`);
    const after = (await (await app.request('/api/prs/acme/app/1899')).json()) as PrDetail;
    expect(after.events.find((view) => view.event.id === muted?.event.id)?.display).toBe('quiet');

    const decided = await post<ActionResult>(app, '/api/proposals/proposal-rename-dev-env', { accept: true });
    expect(decided.json.ok).toBe(true);
    const topic = (await (await app.request('/api/topics/topic-dev-env')).json()) as TopicDetail;
    expect(topic.topic.name).toBe('Dev env and devbox');
  });
});
