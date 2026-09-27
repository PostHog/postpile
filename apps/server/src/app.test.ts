import { describe, expect, it } from 'vitest';
import type { EngineService } from '@code-manager/engine';
import { createApp, TOKEN_HEADER } from './app.ts';

function notImplemented(): never {
  throw new Error('not implemented');
}

function fakeEngine(overrides: Partial<EngineService>): EngineService {
  return {
    sync: notImplemented,
    listTopics: notImplemented,
    getTopic: notImplemented,
    getPr: notImplemented,
    getChat: notImplemented,
    approve: notImplemented,
    markRead: notImplemented,
    undo: notImplemented,
    snooze: notImplemented,
    unsnooze: notImplemented,
    draftAsk: notImplemented,
    sendComment: notImplemented,
    giveFeedback: notImplemented,
    unmuteEvent: notImplemented,
    chat: notImplemented,
    decideTailoring: notImplemented,
    decideTopicProposal: notImplemented,
    flushPendingWrites: notImplemented,
    close: notImplemented,
    ...overrides,
  };
}

describe('server app', () => {
  it('lists topics and enforces the token', async () => {
    const app = createApp(fakeEngine({ listTopics: async () => [] }), 'secret');
    expect((await app.request('/api/topics')).status).toBe(401);
    const res = await app.request('/api/topics', { headers: { [TOKEN_HEADER]: 'secret' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('refuses a bodyless cross-origin approve without the token', async () => {
    let approved = false;
    const approve = async () => {
      approved = true;
      return { ok: true, message: 'Approved', undoToken: null };
    };
    const app = createApp(fakeEngine({ approve }), 'secret');
    const res = await app.request('/api/prs/PostHog/posthog/1/approve', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(401);
    expect(approved).toBe(false);
  });

  it('refuses to start without a token', () => {
    expect(() => createApp(fakeEngine({}), '')).toThrow(/token/);
  });

  it('decodes encoded tile ids', async () => {
    let seen = '';
    const getChat = async (tileId: string) => {
      seen = tileId;
      return [];
    };
    const app = createApp(fakeEngine({ getChat }), 'secret');
    await app.request(`/api/tiles/${encodeURIComponent('pr:PostHog/posthog#1')}/chat`, {
      headers: { [TOKEN_HEADER]: 'secret' },
    });
    expect(seen).toBe('pr:PostHog/posthog#1');
  });
});
