import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { createApp, TOKEN_HEADER } from './app.ts';
import { pollSecondsFromEnv, syncCallCapFromEnv } from './engine-from-env.ts';
import { OFF_POLL_STATUS } from '@postpile/core';

const CONFIG: AppConfig = { fake: false, syncCallCap: 30 };

function notImplemented(): never {
  throw new Error('not implemented');
}

function fakeEngine(overrides: Partial<EngineService>): EngineService {
  return {
    sync: notImplemented,
    pollOnce: notImplemented,
    startLivePoll: notImplemented,
    stopLivePoll: notImplemented,
    livePollStatus: notImplemented,
    listTopics: notImplemented,
    getViewer: notImplemented,
    getTopic: notImplemented,
    search: notImplemented,
    getPr: notImplemented,
    debugNotifications: notImplemented,
    actionLog: notImplemented,
    githubWrites: notImplemented,
    setGitHubWrites: notImplemented,
    sendPendingWrites: notImplemented,
    discardPendingWrites: notImplemented,
    markThreadRead: notImplemented,
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
    listFacts: notImplemented,
    listProposals: notImplemented,
    decideRuleProposal: notImplemented,
    markTopicSeen: notImplemented,
    correctMemory: notImplemented,
    recheckMemory: notImplemented,
    getMemorySources: notImplemented,
    getInstructions: notImplemented,
    getInstructionsChat: notImplemented,
    instructionsChat: notImplemented,
    proposeInstructions: notImplemented,
    saveInstructions: notImplemented,
    consolidate: notImplemented,
    getWorkContext: notImplemented,
    sweepWorkContext: notImplemented,
    forgetWorkThread: notImplemented,
    startWorkContextSchedule: notImplemented,
    stopWorkContextSchedule: notImplemented,
    flushPendingWrites: notImplemented,
    close: notImplemented,
    ...overrides,
  };
}

describe('server app', () => {
  it('serves the work context, runs a sweep and forwards Forget', async () => {
    const forgets: unknown[] = [];
    const app = createApp(
      fakeEngine({
        getWorkContext: async () => ({ current: null, lastError: null, running: false, skipPatterns: [] }),
        sweepWorkContext: async () => ({ ok: true, message: 'v1', version: 1, stats: null }),
        forgetWorkThread: async (input) => {
          forgets.push(input);
          return { ok: true, message: 'Forgot', undoToken: 'memory:workctx:1' };
        },
      }),
      'secret',
      CONFIG,
    );
    const headers = { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' };
    expect(await (await app.request('/api/work-context', { headers })).json()).toEqual({ current: null, lastError: null, running: false, skipPatterns: [] });
    expect(await (await app.request('/api/work-context/sweep', { method: 'POST', headers })).json()).toMatchObject({ ok: true, version: 1 });
    const forget = await app.request('/api/work-context/forget', { method: 'POST', headers, body: JSON.stringify({ version: 1, index: 2 }) });
    expect(await forget.json()).toMatchObject({ ok: true });
    expect(forgets).toEqual([{ version: 1, index: 2 }]);
  });

  it('lists topics and enforces the token', async () => {
    const app = createApp(fakeEngine({ listTopics: async () => [] }), 'secret', CONFIG);
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
    const app = createApp(fakeEngine({ approve }), 'secret', CONFIG);
    const res = await app.request('/api/prs/PostHog/posthog/1/approve', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(401);
    expect(approved).toBe(false);
  });

  it('serves the app config behind the token', async () => {
    const app = createApp(fakeEngine({}), 'secret', CONFIG);
    expect((await app.request('/api/config')).status).toBe(401);
    const res = await app.request('/api/config', { headers: { [TOKEN_HEADER]: 'secret' } });
    expect(await res.json()).toEqual({ fake: false, syncCallCap: 30 });
  });

  it('applies the app call cap to a sync without one, and keeps an explicit cap', async () => {
    const seen: unknown[] = [];
    const sync = async (options: unknown) => {
      seen.push(options);
      return {} as never;
    };
    const app = createApp(fakeEngine({ sync }), 'secret', CONFIG);
    const post = (body?: unknown) =>
      app.request('/api/sync', {
        method: 'POST',
        headers: { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    await post();
    await post({ maxAgentCalls: 5 });
    await post({ maxAgentCalls: 0 });

    expect(seen).toEqual([{ maxAgentCalls: 30 }, { maxAgentCalls: 5 }, { maxAgentCalls: 0 }]);
  });

  it('reads the call cap from the environment', () => {
    expect(syncCallCapFromEnv(undefined)).toBe(150);
    expect(syncCallCapFromEnv('12')).toBe(12);
    expect(syncCallCapFromEnv('0')).toBe(0);
    expect(syncCallCapFromEnv('lots')).toBe(150);
    expect(syncCallCapFromEnv('-3')).toBe(150);
  });

  it('reads the poll interval from the environment, 0 turns it off', () => {
    expect(pollSecondsFromEnv(undefined)).toBe(10);
    expect(pollSecondsFromEnv('30')).toBe(30);
    expect(pollSecondsFromEnv('0')).toBe(0);
    expect(pollSecondsFromEnv('fast')).toBe(10);
    expect(pollSecondsFromEnv('2.5')).toBe(10);
  });

  it('serves the live poll status behind the token', async () => {
    const app = createApp(fakeEngine({ livePollStatus: async () => OFF_POLL_STATUS }), 'secret', CONFIG);
    expect((await app.request('/api/live')).status).toBe(401);
    const res = await app.request('/api/live', { headers: { [TOKEN_HEADER]: 'secret' } });
    expect(await res.json()).toEqual(OFF_POLL_STATUS);
  });

  it('refuses to start without a token', () => {
    expect(() => createApp(fakeEngine({}), '', CONFIG)).toThrow(/token/);
  });

  it('normalises snooze times to UTC and refuses date-only values', async () => {
    const seen: unknown[] = [];
    const snooze = async (_tileId: string, condition: unknown) => {
      seen.push(condition);
      return { ok: true, message: 'Snoozed', undoToken: null };
    };
    const app = createApp(fakeEngine({ snooze }), 'secret', CONFIG);
    const send = (until: string) =>
      app.request('/api/tiles/t/snooze', {
        method: 'POST',
        headers: { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' },
        body: JSON.stringify({ condition: { kind: 'until_time', until } }),
      });

    expect((await send('2026-09-28T10:00:00+02:00')).status).toBe(200);
    expect((await send('2026-09-28')).status).toBe(400);
    expect(seen).toEqual([{ kind: 'until_time', until: '2026-09-28T08:00:00.000Z' }]);
  });

  it('decodes encoded tile ids', async () => {
    let seen = '';
    const getChat = async (tileId: string) => {
      seen = tileId;
      return [];
    };
    const app = createApp(fakeEngine({ getChat }), 'secret', CONFIG);
    await app.request(`/api/tiles/${encodeURIComponent('pr:PostHog/posthog#1')}/chat`, {
      headers: { [TOKEN_HEADER]: 'secret' },
    });
    expect(seen).toBe('pr:PostHog/posthog#1');
  });
});
