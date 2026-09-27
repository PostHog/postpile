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

  it('decodes encoded tile ids', async () => {
    let seen = '';
    const getChat = async (tileId: string) => {
      seen = tileId;
      return [];
    };
    const app = createApp(fakeEngine({ getChat }), null);
    await app.request(`/api/tiles/${encodeURIComponent('pr:PostHog/posthog#1')}/chat`);
    expect(seen).toBe('pr:PostHog/posthog#1');
  });
});
