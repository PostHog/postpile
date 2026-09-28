import { describe, expect, it } from 'vitest';
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
  PrDetail,
  SearchResult,
  TopicDetail,
  TopicListItem,
} from '@code-manager/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const setTile = encodeURIComponent('set:turbo-cache');

const TOKEN = 'test-token';

interface TestApp {
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** Wraps the app so every request carries the token. */
function appWithFake(): TestApp {
  const app = createApp(new FakeEngine(), TOKEN, { fake: true, syncCallCap: 30 });
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

describe('server routes over the fake engine', () => {
  it('lists topics grouped by whether they need the user', async () => {
    const res = await appWithFake().request('/api/topics');
    const topics = (await res.json()) as TopicListItem[];
    const depot = topics.find((item) => item.topic.id === 'topic-depot');
    expect(depot?.group).toBe('needs_you');
    expect(depot?.unreadTiles).toBe(3);
    expect(topics.find((item) => item.topic.id === 'topic-frontend-build')?.group).toBe('quiet');
  });

  it('rechecks a memory line and validates the body', async () => {
    const app = createApp(new FakeEngine({ recheckDelayMs: 0 }), TOKEN, { fake: true, syncCallCap: 30 });
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
    expect(kinds).toEqual(new Set(['tile', 'not_pr', 'pr_not_synced']));
    const depot = rows.find((row) => row.prKey === 'PostHog/posthog#41902');
    expect(depot?.landing).toMatchObject({ kind: 'tile', topicId: 'topic-depot', tileId: 'set:turbo-cache' });
    expect(depot?.recentEvents.length).toBeGreaterThan(0);

    const limited = (await (await app.request('/api/debug/notifications?limit=2')).json()) as NotificationDebugRow[];
    expect(limited).toHaveLength(2);
    expect((await app.request('/api/debug/notifications?limit=0')).status).toBe(400);
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
    const res = await app.request(`/api/search?q=${encodeURIComponent('turbo #41921')}`);
    const result = (await res.json()) as SearchResult;
    expect(result.topics).toEqual([{ topicId: 'topic-depot', tileIds: ['set:turbo-cache'], prKeys: ['PostHog/posthog#41921'] }]);
    const empty = (await (await app.request('/api/search')).json()) as SearchResult;
    expect(empty.topics).toEqual([]);
  });

  it('returns a topic with tiles and says why a tile is unread', async () => {
    const res = await appWithFake().request('/api/topics/topic-depot');
    const detail = (await res.json()) as TopicDetail;
    const set = detail.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.state.kind).toBe('unread');
    expect(set?.state.unreadBecause[0]?.prKey).toBe('PostHog/posthog#41902');
    expect(detail.tiles.find((view) => view.tile.id === 'pr:PostHog/posthog#41899')?.state.kind).toBe('done');
    expect(detail.pendingProposals).toEqual([]);
  });

  it('answers 404 for unknown topics and PRs', async () => {
    const app = appWithFake();
    expect((await app.request('/api/topics/nope')).status).toBe(404);
    expect((await app.request('/api/prs/PostHog/posthog/1')).status).toBe(404);
  });

  it('returns a PR with glance and events', async () => {
    const res = await appWithFake().request('/api/prs/PostHog/posthog/41902');
    const detail = (await res.json()) as PrDetail;
    expect(detail.glance?.verdict).toBe('LOOK_CLOSER');
    expect(detail.tileIds).toEqual(['set:turbo-cache', 'stack:PostHog/posthog#41851']);
    expect(detail.events[0]?.display).toBe('loud');
  });

  it('rejects bad input with 400', async () => {
    const app = appWithFake();
    expect((await app.request('/api/prs/PostHog/posthog/abc')).status).toBe(400);
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
    const marked = await post<ActionResult>(app, `/api/tiles/${setTile}/mark-read`);
    expect(marked.json.undoToken).toBeTruthy();
    let topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'set:turbo-cache')?.state.kind).toBe('done');

    const undone = await post<ActionResult>(app, '/api/undo', { undoToken: marked.json.undoToken });
    expect(undone.json.ok).toBe(true);
    topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'set:turbo-cache')?.state.kind).toBe('unread');
  });

  it('refuses to approve while GitHub writes are off, approves once the lock is open', async () => {
    const app = appWithFake();
    const refused = await post<ActionResult>(app, '/api/prs/PostHog/posthog/41911/approve');
    expect(refused.json.ok).toBe(false);
    const change = await post<GitHubWritesChange>(app, '/api/github-writes', { enabled: true });
    expect(change.json.status.enabled).toBe(true);
    expect(await (await app.request('/api/github-writes')).json()).toEqual({ enabled: true, forcedOffReason: null });
    const res = await post<ActionResult>(app, '/api/prs/PostHog/posthog/41911/approve');
    expect(res.json.ok).toBe(true);
    const detail = (await (await app.request('/api/prs/PostHog/posthog/41911')).json()) as PrDetail;
    expect(detail.userState?.approvedAt).toBeTruthy();
  });

  it('marks a thread read from the debug view, brings its PR back, and logs both', async () => {
    const app = appWithFake();
    const rows = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    const row = rows.find((candidate) => candidate.prKey === 'PostHog/posthog#41902' && candidate.thread.unread)!;
    const marked = await post<ActionResult>(app, `/api/notifications/${encodeURIComponent(row.thread.id)}/mark-read`);
    expect(marked.json.message).toMatch(/here only/);

    const back = await post<ActionResult>(app, '/api/prs/PostHog/posthog/41902/bring-back');
    expect(back.json.ok).toBe(true);

    const log = (await (await app.request('/api/debug/actions')).json()) as ActionLogEntry[];
    expect(log.map((entry) => [entry.action, entry.origin, entry.outcome])).toEqual([
      ['bring_back', 'debug', 'local'],
      ['mark_read', 'debug', 'local'],
    ]);
    const after = (await (await app.request('/api/debug/notifications')).json()) as NotificationDebugRow[];
    expect(after.find((candidate) => candidate.thread.id === row.thread.id)?.lastAction?.action).toBe('bring_back');
    expect((await app.request('/api/debug/actions?limit=0')).status).toBe(400);
  });

  it('snoozes and unsnoozes a tile', async () => {
    const app = appWithFake();
    const tile = encodeURIComponent('pr:PostHog/posthog#41822');
    await post(app, `/api/tiles/${tile}/mark-read`);
    await post(app, `/api/tiles/${tile}/snooze`, { condition: { kind: 'new_push' } });
    let topic = (await (await app.request('/api/topics/topic-ci-tests')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'pr:PostHog/posthog#41822')?.state.kind).toBe('snoozed');
    await app.request(`/api/tiles/${tile}/snooze`, { method: 'DELETE' });
    topic = (await (await app.request('/api/topics/topic-ci-tests')).json()) as TopicDetail;
    expect(topic.tiles.find((view) => view.tile.id === 'pr:PostHog/posthog#41822')?.state.kind).not.toBe('snoozed');
  });

  it('drops a set member on "not related" feedback', async () => {
    const app = appWithFake();
    await post(app, '/api/feedback', { kind: 'not_related', tileId: 'set:turbo-cache', prKey: 'PostHog/posthog#41855' });
    const topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    const set = topic.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.prs.map((pr) => pr.key)).toEqual(['PostHog/posthog#41902', 'PostHog/posthog#41921']);
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
    const fact = (await (await app.request('/api/memory/sources?fact=fact-41902-status')).json()) as MemorySources;
    expect(fact.check).toMatchObject({ state: 'stale', reason: 'head_moved' });
    const line = (await (await app.request('/api/memory/sources?topic=topic-depot&version=3&path=openQuestions%5B0%5D')).json()) as MemorySources;
    expect(line.claim).toBe('Does the Turbo cache warm-up need a feature flag?');
    expect(line.sources.some((source) => source.who === 'lyra' && !source.missing)).toBe(true);
    expect((await app.request('/api/memory/sources?fact=nope')).status).toBe(404);
    expect((await app.request('/api/memory/sources?topic=topic-depot')).status).toBe(400);
  });

  it('drafts an ask and keeps the sent comment local', async () => {
    const app = appWithFake();
    const draft = await post<{ body: string }>(app, '/api/prs/PostHog/posthog/41915/draft-ask', { person: 'rowan', intent: 'why not the org secret?' });
    expect(draft.json.body).toMatch(/^@rowan why not the org secret\?/);
    await post(app, '/api/github-writes', { enabled: true });
    const sent = await post<ActionResult>(app, '/api/prs/PostHog/posthog/41915/comment', { body: draft.json.body });
    expect(sent.json.message).toContain('nothing sent to GitHub');
  });

  it('unmutes an event and decides a proposal', async () => {
    const app = appWithFake();
    const pr = (await (await app.request('/api/prs/PostHog/posthog/41899')).json()) as PrDetail;
    const muted = pr.events.find((view) => view.display === 'muted');
    expect(muted).toBeDefined();
    await post(app, `/api/events/${encodeURIComponent(muted?.event.id ?? '')}/unmute`);
    const after = (await (await app.request('/api/prs/PostHog/posthog/41899')).json()) as PrDetail;
    expect(after.events.find((view) => view.event.id === muted?.event.id)?.display).toBe('quiet');

    const decided = await post<ActionResult>(app, '/api/proposals/proposal-rename-dev-env', { accept: true });
    expect(decided.json.ok).toBe(true);
    const topic = (await (await app.request('/api/topics/topic-dev-env')).json()) as TopicDetail;
    expect(topic.topic.name).toBe('Dev env and hogli');
  });
});
