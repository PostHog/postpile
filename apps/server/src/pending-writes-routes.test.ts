import { describe, expect, it } from 'vitest';
import { UNDO_WINDOW_MS, type ActionResult, type GitHubWritesChange, type GitHubWritesStatus, type PendingWritesResult, type TopicDetail } from '@postpile/core';
import { makeThreadFor } from '@postpile/core/fixtures';
import { makeHarness, type Harness, type HarnessOptions } from '@postpile/engine/testing';
import { reviewRequestedPr } from '@postpile/engine/testing/prs';
import { FakeEngine } from './fake/fake-engine.ts';
import { createApp, TOKEN_HEADER } from './app.ts';

// Pending writes over HTTP, against the real engine with fake GitHub and the
// fake sample engine. Nothing here reaches GitHub.

const TOKEN = 'test-token';
const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;

interface TestApp {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

function wrap(app: ReturnType<typeof createApp>): TestApp {
  const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };
  return {
    get: async <T>(path: string) => (await (await app.request(path, { headers })).json()) as T,
    post: async <T>(path: string, body: unknown = {}) =>
      (await (await app.request(path, { method: 'POST', body: JSON.stringify(body), headers })).json()) as T,
  };
}

async function engineApp(options: HarnessOptions): Promise<{ app: TestApp; h: Harness }> {
  const h = makeHarness(options);
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return { app: wrap(createApp(h.engine, TOKEN, { fake: false, syncCallCap: 0, syncOnStart: true, profile: 'default', databasePath: null })), h };
}

async function afterUndoWindow(h: Harness): Promise<void> {
  h.timers.advance(UNDO_WINDOW_MS);
  await new Promise((resolve) => setImmediate(resolve));
}

async function tileState(app: TestApp): Promise<{ kind: string; pending: boolean }> {
  const topic = await app.get<TopicDetail>('/api/topics/unsorted');
  const view = topic.tiles.find((candidate) => candidate.tile.id === tileId);
  return { kind: view?.state.kind ?? 'missing', pending: view?.pendingWrite !== null && view?.pendingWrite !== undefined };
}

describe('pending writes routes (real engine, fake GitHub)', () => {
  it('a locked mark-read becomes pending and leaves the tile unread; unlock and send delivers and logs it', async () => {
    const { app, h } = await engineApp({ writesEnabled: false });

    await app.post<ActionResult>(`/api/tiles/${encodeURIComponent(tileId)}/mark-read`);
    await afterUndoWindow(h);

    expect(await tileState(app)).toEqual({ kind: 'unread', pending: true });
    const status = await app.get<GitHubWritesStatus>('/api/github-writes');
    expect(status.pending).toEqual([expect.objectContaining({ title: pr.title, threadCount: 1 })]);

    const change = await app.post<GitHubWritesChange>('/api/github-writes', { enabled: true });
    expect(change.status.pending).toHaveLength(1);
    const sent = await app.post<PendingWritesResult>('/api/github-writes/pending/send');

    expect(sent).toMatchObject({ ok: true, done: 1, failed: 0 });
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(await tileState(app)).toEqual({ kind: 'done', pending: false });
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ action: 'mark_read', origin: 'footer', outcome: 'github' });
  });

  it('discard leaves everything unread and sends nothing', async () => {
    const { app, h } = await engineApp({ writesEnabled: false });
    await app.post(`/api/tiles/${encodeURIComponent(tileId)}/mark-read`);
    await afterUndoWindow(h);

    const discarded = await app.post<PendingWritesResult>('/api/github-writes/pending/discard');

    expect(discarded.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual([]);
    expect(await tileState(app)).toEqual({ kind: 'unread', pending: false });
    expect(h.store.notifications.get('thread-1')?.unread).toBe(true);
  });

  it('POSTPILE_READ_ONLY=1 keeps them pending and refuses the send', async () => {
    const { app, h } = await engineApp({ forcedReadOnly: true });
    await app.post(`/api/tiles/${encodeURIComponent(tileId)}/mark-read`);
    await afterUndoWindow(h);

    const change = await app.post<GitHubWritesChange>('/api/github-writes', { enabled: true });
    const sent = await app.post<PendingWritesResult>('/api/github-writes/pending/send');

    expect(change.ok).toBe(false);
    expect(sent).toMatchObject({ ok: false, done: 0, failed: 1 });
    expect(sent.status.pending).toHaveLength(1);
    expect(h.writer.calls).toEqual([]);
    expect(await tileState(app)).toEqual({ kind: 'unread', pending: true });
  });
});

describe('pending writes routes (fake mode)', () => {
  it('works on sample data: pending after the window, send after unlock', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const app = wrap(createApp(new FakeEngine({ now: () => now }), TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null }));
    const setTile = encodeURIComponent('set:turbo-cache');

    await app.post(`/api/tiles/${setTile}/mark-read`);
    now = new Date(now.getTime() + UNDO_WINDOW_MS + 1000);

    expect((await app.get<GitHubWritesStatus>('/api/github-writes')).pending).toHaveLength(1);
    expect((await app.post<PendingWritesResult>('/api/github-writes/pending/send')).ok).toBe(false);
    await app.post('/api/github-writes', { enabled: true });
    const sent = await app.post<PendingWritesResult>('/api/github-writes/pending/send');
    expect(sent).toMatchObject({ ok: true, done: 1 });
    const topic = await app.get<TopicDetail>('/api/topics/topic-depot');
    // Read, but reviews are still asked of you there: it stays open, not done.
    expect(topic.tiles.find((view) => view.tile.id === 'set:turbo-cache')?.state.kind).toBe('open');
  });
});
