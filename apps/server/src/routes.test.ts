import { describe, expect, it, vi } from 'vitest';
import type {
  ActionLogEntry,
  ActivityEvent,
  ActionResult,
  BusyInboxView,
  ChatReply,
  GitHubWritesChange,
  GlanceLookResult,
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
  SyncReport,
  TeamRolesView,
  TopicDetail,
  TopicListItem,
  ViewerView,
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

/** Every row the PR pane can show, lines and folded bot rows alike. */
function activityItems(detail: PrDetail): ActivityEvent[] {
  const { fresh, earlier, noise, freshNoise } = detail.activity;
  return [...fresh, ...earlier, ...noise, ...freshNoise];
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

  it('rewrites the stale sample glance when looked at: writing, then current', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, catchUpStepMs: 5 }));
    const stale = (await allRows(app)).find((row) => row.glanceStale);
    expect(stale).toBeDefined();
    const path = `/api/prs/${stale!.key.replace('#', '/')}`;
    expect(((await (await app.request(path)).json()) as PrDetail).glanceRefreshBlock).toBeNull();

    const res = await post<GlanceLookResult>(app, `${path}/glance/look`);

    expect(res.json).toEqual({ outcome: 'started' });
    expect(((await (await app.request(path)).json()) as PrDetail).glanceState).toBe('writing');
    expect((await post<GlanceLookResult>(app, `${path}/glance/look`)).json).toEqual({ outcome: 'covered' });
    await vi.waitFor(async () => expect(((await (await app.request(path)).json()) as PrDetail).glanceStale).toBe(false));
    expect((await post<GlanceLookResult>(app, `${path}/glance/look`)).json).toEqual({ outcome: 'current' });
  });

  it('holds the sample start sync for the inbox catch-up, parks a clear while locked and runs it from the lock', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, cleanupStepMs: 0, catchUpGate: true }));
    const cleanup = async () => (await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView;

    expect((await post<SyncReport>(app, '/api/sync')).json.heldForCatchUp).toBe(true);
    const view = await cleanup();
    // 24 merged PRs only in the inbox, plus the merged sample tiles still unread.
    expect(view).toMatchObject({ start: { kind: 'first_run' }, counts: { mergedAll: 27 }, pending: false });

    const parked = await post<{ ok: boolean; message: string }>(app, '/api/inbox-cleanup/clear', { merged: 'all', older: null, countedAt: view.countedAt, from: 'start' });
    expect(parked.json.message).toMatch(/^Pending: clears 27/);
    const writes = (await (await app.request('/api/github-writes')).json()) as GitHubWritesStatus;
    expect(writes.pending).toEqual([expect.objectContaining({ kind: 'catch_up', origin: 'cleanup', threadCount: 27 })]);
    expect((await cleanup()).start).toBeNull();

    await post(app, '/api/github-writes', { enabled: true });
    await post(app, '/api/github-writes/pending/send');
    await vi.waitFor(async () => expect((await cleanup()).lastRun).toMatchObject({ marked: 27 }));
    expect((await cleanup()).counts.mergedAll).toBe(0);

    expect((await post(app, '/api/inbox-cleanup/clear', { merged: 'quiet3', older: null, countedAt: view.countedAt, from: 'start' })).status).toBe(400);
    expect((await app.request('/api/inbox-cleanup/mark-read', { method: 'POST' })).status).toBe(404);
  });

  it('clears only the sample merged PRs that look safe from the sidebar item', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, cleanupStepMs: 0 }));
    const cleanup = async () => (await (await app.request('/api/inbox-cleanup')).json()) as InboxCleanupView;
    await post(app, '/api/github-writes', { enabled: true });
    const view = await cleanup();
    expect(view.counts).toMatchObject({ mergedAll: 27, mergedSafe: 8 });

    expect((await post<{ message: string }>(app, '/api/inbox-cleanup/clear-safe', { countedAt: view.countedAt })).json.message).toBe('Clearing 8 on GitHub in the background');
    await vi.waitFor(async () => expect((await cleanup()).lastRun).toMatchObject({ marked: 8 }));
    expect((await cleanup()).counts).toMatchObject({ mergedAll: 19, mergedSafe: 0 });
  });

  it('lists repos, keeps the topics of the chosen repo, labels other repos and sets a repo quiet', async () => {
    const app = appWithFake();
    const repos = (await (await app.request('/api/repos')).json()) as RepoOverview;
    expect(repos.scope).toBeNull();
    expect(repos.repos.map((entry) => [entry.repo, entry.topics])).toEqual([
      ['acme/app', 14],
      ['acme/python-sdk', 2],
      ['acme/desktop', 1],
      ['acme/infra', 1],
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

  it('keeps the interruptions pick, never by default', async () => {
    const app = appWithFake();
    expect(await (await app.request('/api/interruptions')).json()).toEqual({ mode: 'never', chosen: false, roundupTimes: ['9:30', '13:30', '16:30'] });
    const put = (body: unknown) => app.request('/api/interruptions', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(await (await put({ mode: 'batches' })).json()).toMatchObject({ mode: 'batches', chosen: true });
    expect(await (await app.request('/api/interruptions')).json()).toMatchObject({ mode: 'batches', chosen: true });
    expect(await (await put({ mode: 'never', from: 'prompt' })).json()).toMatchObject({ mode: 'never', chosen: true });
    expect((await put({ mode: 'loud' })).status).toBe(400);
    expect((await put({ mode: 'never', from: 'setup' })).status).toBe(400);
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

  it('says the sample inbox is not busy, with every sample PR kept', async () => {
    const view = (await (await appWithFake().request('/api/busy-inbox')).json()) as BusyInboxView;

    expect(view.busy).toBe(false);
    expect(view.quietPrs).toBe(0);
    expect(view.keptPrs).toBe(view.inboxPrs);
    expect(view.keptYou + view.keptTeam + view.keptOthers).toBe(view.keptPrs);
    expect(view.keptYou).toBeGreaterThan(0);
    expect(view.cap).toBe(1500);
  });

  it('shows a busy inbox with POSTPILE_FAKE_BUSY numbers', async () => {
    const app = appWithFake(new FakeEngine({ syncStepMs: 0, busy: true }));

    const view = (await (await app.request('/api/busy-inbox')).json()) as BusyInboxView;

    expect(view).toEqual({
      busy: true,
      inboxPrs: 6140,
      keptPrs: 1500,
      quietPrs: 4640,
      cap: 1500,
      updatesLastHour: 300,
      writesLocked: true,
      keptYou: 940,
      keptTeam: 560,
      keptOthers: 0,
    });
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
    expect(quiet.map((item) => item.prKey)).toEqual(['acme/app#1899', 'acme/app#1904', 'acme/app#1911', 'acme/app#1934', 'acme/app#1960', 'acme/app#1921', 'acme/app#1963']);
    expect(quiet[1]).toMatchObject({ repo: 'acme/app', number: 1904, title: 'Hash Turbo inputs by lockfile only', reason: 'bots', bots: ['trunk-io[bot]', 'vercel[bot]'] });
    expect(quiet[2]).toMatchObject({ number: 1911, reason: 'approved', bots: [] });
    expect(quiet[3]).toMatchObject({ number: 1934, reason: 'judged', bots: ['lyra', 'vercel[bot]'] });

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

    const notMarked = { marked: false, undoToken: null, undoUntil: null };
    expect((await opened(doneKey)).json).toEqual(notMarked);
    await post(app, '/api/github-writes', { enabled: true });
    expect((await opened(yours.tile.members[0]!.prKey)).json).toEqual(notMarked);
    const marked = (await opened(doneKey)).json;
    expect(marked).toEqual({ marked: true, undoToken: expect.any(String), undoUntil: expect.any(String) });
    expect((await opened(doneKey)).json).toEqual(notMarked);
    // Handled in PostPile too: the tile is done now, not just read.
    const tileState = async () => {
      const topic = (await (await app.request(`/api/topics/${done.tile.topicId}`)).json()) as TopicDetail;
      return topic.tiles.find((view) => view.tile.id === done.tile.id)?.state.kind;
    };
    expect(await tileState()).toBe('done');

    // The button's Undo takes it back through the mark-read undo window.
    await post(app, '/api/undo', { undoToken: marked.undoToken });
    expect(await tileState()).toBe(done.state.kind);
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
    expect(set?.state.loud).toBe(true);
    expect(set?.state.unreadBecause.map((reason) => reason.prKey)).toContain('acme/app#1907');
    expect(detail.tiles.find((view) => view.tile.id === 'pr:acme/app#1899')?.state.kind).toBe('done');
    expect(detail.pendingProposals).toEqual([]);
  });

  it('answers 404 for unknown topics and PRs', async () => {
    const app = appWithFake();
    expect((await app.request('/api/topics/nope')).status).toBe(404);
    expect((await app.request('/api/prs/acme/app/1')).status).toBe(404);
  });

  it('returns a PR with glance and activity', async () => {
    const res = await appWithFake().request('/api/prs/acme/app/1902');
    const detail = (await res.json()) as PrDetail;
    expect(detail.glance?.verdict).toBe('LOOK_CLOSER');
    // One unit per PR: #1902 is a stack layer, so it is in the stack tile only.
    expect(detail.tileIds).toEqual(['stack:acme/app#1851']);
    expect(detail.activity.fresh[0]).toMatchObject({ actor: 'lyra', display: 'loud' });
    // Every event is in the activity, cut to what a row draws; there is no second, raw list.
    expect(detail).not.toHaveProperty('events');
    const deploy = activityItems(detail).find((item) => item.kind === 'deploy');
    expect(Object.keys(deploy ?? {}).sort()).toEqual(['actor', 'at', 'display', 'id', 'kind', 'reason', 'summary', 'unseen']);
    expect(detail.activity.fresh[0]).not.toHaveProperty('events');
  });

  it('sends the slim PR view: no comments, threads, commits, timeline or checks', async () => {
    const detail = (await (await appWithFake().request('/api/prs/acme/app/1902')).json()) as PrDetail;
    expect(Object.keys(detail.pr).sort()).toEqual([
      'additions',
      'assignees',
      'author',
      'baseRef',
      'body',
      'changedFiles',
      'createdAt',
      'deletions',
      'files',
      'headOid',
      'headRef',
      'isDraft',
      'key',
      'lastCommitAt',
      'mergedAt',
      'mergedBy',
      'ref',
      'reviewDecision',
      'reviewerTeams',
      'reviewerUsers',
      'reviews',
      'state',
      'title',
      'updatedAt',
      'url',
    ]);
    expect(Object.keys(detail.pr.reviews[0] ?? {}).sort()).toEqual(['author', 'state', 'submittedAt']);
    expect(detail.pr.files.map((file) => file.path)).toContain('turbo.json');
    // Replies and reactions still find their comment: the activity line carries it.
    const lines = [...detail.activity.fresh, ...detail.activity.earlier];
    expect(lines.find((line) => line.reply?.commentId === 'issuecomment-2')?.reply).toMatchObject({ author: 'lyra', canReply: true });
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

  it('removes a team review request only with a team, and refuses it while writes are locked', async () => {
    const app = appWithFake();
    const rows = await allRows(app);
    const row = rows.find((pr) => pr.ownTeamRequests.length > 0)!;
    const path = `/api/prs/${row.key.replace('#', '/')}/remove-team-request`;
    expect((await post(app, path, {})).status).toBe(400);
    expect((await post<ActionResult>(app, path, { team: row.ownTeamRequests[0] })).json.ok).toBe(false);
    await post(app, '/api/github-writes', { enabled: true });
    expect((await post<ActionResult>(app, path, { team: row.ownTeamRequests[0] })).json.ok).toBe(true);
  });

  it('refuses to approve while GitHub writes are off, approves once the lock is open', async () => {
    const app = appWithFake();
    const head = ((await (await app.request('/api/prs/acme/app/1911')).json()) as PrDetail).pr.headOid;
    const refused = await post<ActionResult>(app, '/api/prs/acme/app/1911/approve', { headOid: head });
    expect(refused.json.ok).toBe(false);
    const change = await post<GitHubWritesChange>(app, '/api/github-writes', { enabled: true });
    expect(change.json.status.enabled).toBe(true);
    expect(await (await app.request('/api/github-writes')).json()).toEqual({ enabled: true, forcedOffReason: null, pending: [] });
    expect((await post(app, '/api/prs/acme/app/1911/approve', {})).status).toBe(400);
    const moved = await post<ActionResult>(app, '/api/prs/acme/app/1911/approve', { headOid: 'older-head' });
    expect(moved.json).toMatchObject({ ok: false, message: 'New commits since you looked; take another look' });
    const res = await post<ActionResult>(app, '/api/prs/acme/app/1911/approve', { headOid: head });
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
    const reply = await post<ChatReply>(app, '/api/topics/topic-depot/chat', { message: 'Always flag Turbo version bumps here' });
    expect(reply.json.lastingPoint).toMatchObject({ topicId: 'topic-depot', text: 'Always flag Turbo version bumps here' });
    const history = (await (await app.request('/api/topics/topic-depot/chat')).json()) as unknown[];
    expect(history).toHaveLength(2);

    await post(app, '/api/topics/topic-depot/tailoring', { text: 'Always flag Turbo version bumps here', keep: true });
    const topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.topic.tailoring).toContain('Always flag Turbo version bumps here');
  });

  it('turns a point the user keeps for all topics into an instructions proposal and saves it on accept', async () => {
    const app = appWithFake();
    const reply = await post<ChatReply>(app, '/api/topics/topic-depot/chat', { message: 'From now on flag every CI timeout change' });
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

  it('replies to a thread comment and an issue comment, and keeps both local', async () => {
    const app = appWithFake();
    const locked = await post<ActionResult>(app, '/api/prs/acme/app/1902/reply', { commentId: 'thread-1902-1-0', body: 'Yes, next layer.' });
    expect(locked.json.ok).toBe(false);
    await post(app, '/api/github-writes', { enabled: true });
    const inThread = await post<ActionResult>(app, '/api/prs/acme/app/1902/reply', { commentId: 'thread-1902-1-0', body: 'Yes, next layer.' });
    const quoting = await post<ActionResult>(app, '/api/prs/acme/app/1902/reply', { commentId: 'issuecomment-2', body: 'One cold hour is fine.' });
    expect([inThread.json.ok, quoting.json.ok]).toEqual([true, true]);
    // The pane sees the replies in the activity: one in the code thread as typed, one as a new PR comment quoting lyra.
    const detail = (await (await app.request('/api/prs/acme/app/1902')).json()) as PrDetail;
    const replies = [...detail.activity.fresh, ...detail.activity.earlier].filter((line) => line.actor === 'you' && line.kind === 'comment');
    // Newest first, and both may share a millisecond: compare sorted.
    expect(replies.map((line) => [line.summary, line.body]).sort()).toEqual([
      ['you replied to lyra: One cold hour is fine.', expect.stringMatching(/^> @you does the warm-up job need a feature flag[^\n]*\n\n@lyra One cold hour is fine\.$/)],
      ['you replied to nell: Yes, next layer.', 'Yes, next layer.'],
    ]);
    expect((await post<ActionResult>(app, '/api/prs/acme/app/1902/reply', { commentId: 'nope', body: 'x' })).json.ok).toBe(false);
    expect((await post(app, '/api/prs/acme/app/1902/reply', { commentId: 'issuecomment-2', body: '' })).status).not.toBe(200);
  });

  it('gives a thumbs up to a comment and to a review', async () => {
    const app = appWithFake();
    await post(app, '/api/github-writes', { enabled: true });
    expect((await post<ActionResult>(app, '/api/prs/acme/app/1902/react', { commentId: 'issuecomment-2' })).json.ok).toBe(true);
    expect((await post<ActionResult>(app, '/api/prs/acme/app/1902/react', { commentId: 'review-1902-0' })).json.ok).toBe(true);
    // The pane reads the reaction on the comment's activity line, not on the PR.
    const { activity } = (await (await app.request('/api/prs/acme/app/1902')).json()) as PrDetail;
    const lines = [...activity.fresh, ...activity.earlier];
    expect(lines.find((line) => line.reply?.commentId === 'issuecomment-2')?.reply?.viewerReacted).toBe(true);
    expect((await post<ActionResult>(app, '/api/prs/acme/app/1902/react', { commentId: 'nope' })).json.ok).toBe(false);
  });

  it('drafts replies and review notes from a gist', async () => {
    const app = appWithFake();
    const fromContext = await post<{ body: string }>(app, '/api/prs/acme/app/1902/draft-reply', { commentId: 'thread-1902-1-0' });
    expect(fromContext.json.body).not.toBe('');
    const fromGist = await post<{ body: string }>(app, '/api/prs/acme/app/1902/draft-reply', { commentId: 'issuecomment-2', gist: 'one cold hour is fine' });
    expect(fromGist.json.body).toBe('One cold hour is fine.');
    const note = await post<{ body: string }>(app, '/api/prs/acme/app/1902/draft-review-note', { kind: 'approve', gist: 'watch the first cold run' });
    expect(note.json.body).toBe('Watch the first cold run.');
    const plainNote = await post<{ body: string }>(app, '/api/prs/acme/app/1902/draft-review-note', { kind: 'approve' });
    expect(plainNote.json.body).toBe('No blockers. A test for the retry limit can follow.');
  });

  it('chats on a whole topic, apart from the tile chats', async () => {
    const app = appWithFake();
    const reply = await post<ChatReply>(app, '/api/topics/topic-depot/chat', { message: 'always flag runner image changes' });
    expect(reply.json.lastingPoint).toMatchObject({ topicId: 'topic-depot' });
    const chat = (await (await app.request('/api/topics/topic-depot/chat')).json()) as ChatReply['message'][];
    expect(chat.map((message) => [message.tileId, message.role])).toEqual([
      ['topic:topic-depot', 'user'],
      ['topic:topic-depot', 'agent'],
    ]);
    const unsorted = await post<ChatReply>(app, '/api/topics/unsorted/chat', { message: 'always flag runner image changes' });
    expect(unsorted.json.lastingPoint).toMatchObject({ topicId: null });
    expect((await post(app, '/api/topics/topic-depot/chat', { message: '' })).status).not.toBe(200);
  });

  it('unmutes an event and decides a proposal', async () => {
    const app = appWithFake();
    const pr = (await (await app.request('/api/prs/acme/app/1899')).json()) as PrDetail;
    const muted = activityItems(pr).find((item) => item.display === 'muted');
    expect(muted).toBeDefined();
    await post(app, `/api/events/${encodeURIComponent(muted?.id ?? '')}/unmute`);
    const after = (await (await app.request('/api/prs/acme/app/1899')).json()) as PrDetail;
    expect(activityItems(after).find((item) => item.id === muted?.id)?.display).toBe('quiet');

    const decided = await post<ActionResult>(app, '/api/proposals/proposal-rename-dev-env', { accept: true });
    expect(decided.json.ok).toBe(true);
    const topic = (await (await app.request('/api/topics/topic-dev-env')).json()) as TopicDetail;
    expect(topic.topic.name).toBe('Dev env and devbox');
  });

  it('lists team roles and flips one, which empties the teammates', async () => {
    const app = appWithFake();
    const roles = (await (await app.request('/api/team-roles')).json()) as TeamRolesView;
    expect(roles.teams.map((team) => [team.slug, team.role, team.reason])).toEqual([
      ['team-platform', 'home', '57% of your reviews'],
      ['client-approvers', 'routing', '4% of your reviews'],
    ]);

    const flipped = await post<TeamRolesView>(app, '/api/team-roles', { team: 'acme/team-platform', role: 'routing' });
    expect(flipped.json.teams[0]).toMatchObject({ role: 'routing', source: 'user', reason: 'set by you' });
    const viewer = (await (await app.request('/api/viewer')).json()) as ViewerView;
    expect(viewer.teamMembers).toEqual([]);

    expect((await post(app, '/api/team-roles', { team: 'acme/other', role: 'home' })).status).toBe(400);
    expect((await post(app, '/api/team-roles', { team: 'acme/team-platform', role: 'owner' })).status).toBe(400);
  });

  it('shows a routing team request with the routing chip, and a home team request with the team chip', async () => {
    const rows = await allRows(appWithFake());
    expect(rows.find((row) => row.key === 'acme/python-sdk#1966')?.forWhom).toEqual({ kind: 'routing', team: 'client-approvers' });
    expect(rows.find((row) => row.key === 'acme/python-sdk#1967')?.forWhom).toEqual({ kind: 'routing', team: 'client-approvers' });
    expect(rows.find((row) => row.key === 'acme/app#1932')?.forWhom).toEqual({ kind: 'team', team: 'team-platform' });
  });
});
