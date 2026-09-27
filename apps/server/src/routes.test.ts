import { describe, expect, it } from 'vitest';
import type {
  ActionResult,
  ChatReply,
  InstructionsChatReply,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  MemorySources,
  PrDetail,
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
  const app = createApp(new FakeEngine(), TOKEN, { fake: true, writesAllowed: true });
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

  it('approves a PR', async () => {
    const app = appWithFake();
    const res = await post<ActionResult>(app, '/api/prs/PostHog/posthog/41911/approve');
    expect(res.json.ok).toBe(true);
    const detail = (await (await app.request('/api/prs/PostHog/posthog/41911')).json()) as PrDetail;
    expect(detail.userState?.approvedAt).toBeTruthy();
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
    expect(reply.json.tailoringProposal?.topicId).toBe('topic-depot');
    expect(reply.json.instructionsProposal).toBeNull();
    const history = (await (await app.request(`/api/tiles/${setTile}/chat`)).json()) as unknown[];
    expect(history).toHaveLength(2);

    await post(app, '/api/topics/topic-depot/tailoring', { text: 'Always flag Turbo version bumps here', keep: true });
    const topic = (await (await app.request('/api/topics/topic-depot')).json()) as TopicDetail;
    expect(topic.topic.tailoring).toContain('Always flag Turbo version bumps here');
  });

  it('turns a point about every topic into an instructions proposal and saves it on accept', async () => {
    const app = appWithFake();
    const reply = await post<ChatReply>(app, `/api/tiles/${setTile}/chat`, { message: 'From now on flag every CI timeout change' });
    const proposal = reply.json.instructionsProposal;
    expect(reply.json.tailoringProposal).toBeNull();
    expect(proposal?.text).toContain('- From now on flag every CI timeout change');

    const saved = await post<InstructionsSaveResult>(app, '/api/instructions', { proposal, text: proposal?.text });
    expect(saved.json).toMatchObject({ ok: true, savedVersion: 4 });
    expect(saved.json.message).toContain('Will refresh 2 topic dossiers');
    const view = (await (await app.request('/api/instructions')).json()) as InstructionsView;
    expect(view.versions[0]).toMatchObject({ version: 4, origin: 'chat', sourceText: 'From now on flag every CI timeout change' });

    const stale = await post<InstructionsSaveResult>(app, '/api/instructions', { proposal, text: proposal?.text });
    expect(stale.json.ok).toBe(false);
    expect(stale.json.rebased?.baseVersion).toBe(4);
  });

  it('proposes from the general instructions chat and from a tailoring switch', async () => {
    const app = appWithFake();
    const chat = await post<InstructionsChatReply>(app, '/api/instructions/chat', { message: 'Skip docs-only PRs' });
    expect(chat.json.proposal?.summary).toBe('Added: Skip docs-only PRs');
    const history = (await (await app.request('/api/instructions/chat')).json()) as unknown[];
    expect(history.length).toBeGreaterThanOrEqual(4);

    const tile = await post<ChatReply>(app, `/api/tiles/${setTile}/chat`, { message: 'Always flag Turbo bumps here' });
    const sourceChatMessageId = tile.json.tailoringProposal?.sourceChatMessageId;
    const switched = await post<InstructionsProposalReply>(app, '/api/instructions/proposals', { sourceChatMessageId, point: 'Flag Turbo bumps', topicId: 'topic-depot' });
    expect(switched.json.proposal).toMatchObject({ point: 'Flag Turbo bumps', topicId: 'topic-depot', sourceChatMessageId });
  });

  it('answers "Why?" for facts and dossier lines', async () => {
    const app = appWithFake();
    const fact = (await (await app.request('/api/memory/sources?fact=fact-41902-status')).json()) as MemorySources;
    expect(fact.check).toMatchObject({ state: 'stale', reason: 'head_moved' });
    const line = (await (await app.request('/api/memory/sources?topic=topic-depot&version=3&path=openQuestions%5B0%5D')).json()) as MemorySources;
    expect(line.claim).toBe('Does the Turbo cache warm-up need a feature flag?');
    expect((await app.request('/api/memory/sources?fact=nope')).status).toBe(404);
    expect((await app.request('/api/memory/sources?topic=topic-depot')).status).toBe(400);
  });

  it('drafts an ask and keeps the sent comment local', async () => {
    const app = appWithFake();
    const draft = await post<{ body: string }>(app, '/api/prs/PostHog/posthog/41915/draft-ask', { person: 'rowan', intent: 'why not the org secret?' });
    expect(draft.json.body).toMatch(/^@rowan why not the org secret\?/);
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
