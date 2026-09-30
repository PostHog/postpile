import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { FakeTelemetry } from '@postpile/engine/testing';
import { createApp, TOKEN_HEADER } from './app.ts';
import { UpdatesOff } from './update-check.ts';
import { appConfigFromEnv, autoSyncMinutesFromEnv, pollSecondsFromEnv, syncCallCapFromEnv } from './engine-from-env.ts';
import { OFF_POLL_STATUS } from '@postpile/core';

const CONFIG: AppConfig = { fake: false, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 };

function notImplemented(): never {
  throw new Error('not implemented');
}

function fakeEngine(overrides: Partial<EngineService>): EngineService {
  return {
    sync: notImplemented,
    setupStatus: notImplemented,
    setupChecks: notImplemented,
    tools: notImplemented,
    checkTools: notImplemented,
    mcpConnection: notImplemented,
    connectMcp: notImplemented,
    hideMcpConnect: notImplemented,
    startSetupSweep: notImplemented,
    setupSweep: notImplemented,
    refineSetup: notImplemented,
    checkSetupFit: notImplemented,
    acceptSetup: notImplemented,
    skipSetup: notImplemented,
    lastSyncReport: notImplemented,
    recordedAppVersion: notImplemented,
    syncProgress: notImplemented,
    pollOnce: notImplemented,
    startLivePoll: notImplemented,
    stopLivePoll: notImplemented,
    startAutoSync: notImplemented,
    stopAutoSync: notImplemented,
    retryGlance: notImplemented,
    livePollStatus: notImplemented,
    refreshOnFocus: notImplemented,
    listTopics: notImplemented,
    unreadPrKeys: notImplemented,
    boardShape: notImplemented,
    onSyncCompleted: notImplemented,
    listFinishedTopics: notImplemented,
    getViewer: notImplemented,
    getTeamRoles: notImplemented,
    setTeamRole: notImplemented,
    listRepos: notImplemented,
    setRepoScope: notImplemented,
    setRepoQuiet: notImplemented,
    getTopic: notImplemented,
    search: notImplemented,
    getPr: notImplemented,
    debugNotifications: notImplemented,
    handledQuietly: notImplemented,
    actionLog: notImplemented,
    githubWrites: notImplemented,
    inboxCleanup: notImplemented,
    cleanUpInbox: notImplemented,
    hideInboxCleanup: notImplemented,
    setGitHubWrites: notImplemented,
    sendPendingWrites: notImplemented,
    discardPendingWrites: notImplemented,
    markThreadRead: notImplemented,
    markOpenedRead: notImplemented,
    getChat: notImplemented,
    approve: notImplemented,
    markRead: notImplemented,
    markPrRead: notImplemented,
    removeTeamRequest: notImplemented,
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
    refreshNow: notImplemented,
    proposeTopicChange: notImplemented,
    startAgentRequests: () => {},
    stopAgentRequests: () => {},
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
    setSweepSkip: notImplemented,
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

  it('saves the sweep skip list', async () => {
    const saved: string[][] = [];
    const app = createApp(
      fakeEngine({
        setSweepSkip: async (patterns) => {
          saved.push(patterns);
          return { ok: true, message: 'saved', undoToken: null };
        },
      }),
      'secret',
      CONFIG,
    );
    const headers = { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' };
    const res = await app.request('/api/work-context/skip-list', { method: 'PUT', headers, body: JSON.stringify({ patterns: ['taxes', 'side-project'] }) });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(saved).toEqual([['taxes', 'side-project']]);
    const bad = await app.request('/api/work-context/skip-list', { method: 'PUT', headers, body: JSON.stringify({ patterns: 'taxes' }) });
    expect(bad.status).toBe(400);
  });

  it('lists topics and enforces the token', async () => {
    const app = createApp(fakeEngine({ listTopics: async () => [] }), 'secret', CONFIG);
    expect((await app.request('/api/topics')).status).toBe(401);
    const res = await app.request('/api/topics', { headers: { [TOKEN_HEADER]: 'secret' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('tells the host about writes, not reads or refused requests', async () => {
    let writes = 0;
    const markRead = async () => ({ ok: true, message: 'Marked read', undoToken: null });
    const engine = fakeEngine({ listTopics: async () => [], markRead });
    const app = createApp(engine, 'secret', CONFIG, undefined, undefined, () => (writes += 1));
    const headers = { [TOKEN_HEADER]: 'secret' };
    await app.request('/api/topics', { headers });
    await app.request('/api/tiles/t1/mark-read', { method: 'POST' });
    expect(writes).toBe(0);
    await app.request('/api/tiles/t1/mark-read', { method: 'POST', headers });
    expect(writes).toBe(1);
  });

  it('refuses a bodyless cross-origin approve without the token', async () => {
    let approved = false;
    const approve = async () => {
      approved = true;
      return { ok: true, message: 'Approved', undoToken: null };
    };
    const app = createApp(fakeEngine({ approve }), 'secret', CONFIG);
    const res = await app.request('/api/prs/acme/app/1/approve', {
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
    expect(await res.json()).toEqual({ fake: false, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 });
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

  it('applies the app call cap to a consolidation without one', async () => {
    const seen: unknown[] = [];
    const consolidate = async (options: unknown) => {
      seen.push(options);
      return {} as never;
    };
    const app = createApp(fakeEngine({ consolidate }), 'secret', CONFIG);
    const post = (body?: unknown) =>
      app.request('/api/consolidate', {
        method: 'POST',
        headers: { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    await post();
    await post({ maxAgentCalls: 2 });

    expect(seen).toEqual([{ maxAgentCalls: 30 }, { maxAgentCalls: 2 }]);
  });

  it('reads the call cap from the environment', () => {
    expect(syncCallCapFromEnv(undefined)).toBe(150);
    expect(syncCallCapFromEnv('12')).toBe(12);
    expect(syncCallCapFromEnv('0')).toBe(0);
    expect(syncCallCapFromEnv('lots')).toBe(150);
    expect(syncCallCapFromEnv('-3')).toBe(150);
  });

  it('syncs on start unless POSTPILE_SYNC_ON_START=0', () => {
    const before = process.env.POSTPILE_SYNC_ON_START;
    try {
      delete process.env.POSTPILE_SYNC_ON_START;
      expect(appConfigFromEnv().syncOnStart).toBe(true);
      process.env.POSTPILE_SYNC_ON_START = '0';
      expect(appConfigFromEnv().syncOnStart).toBe(false);
    } finally {
      if (before === undefined) {
        delete process.env.POSTPILE_SYNC_ON_START;
      } else {
        process.env.POSTPILE_SYNC_ON_START = before;
      }
    }
  });

  it('reads the poll interval from the environment, 0 turns it off', () => {
    expect(pollSecondsFromEnv(undefined)).toBe(60);
    expect(pollSecondsFromEnv('30')).toBe(30);
    expect(pollSecondsFromEnv('0')).toBe(0);
    expect(pollSecondsFromEnv('fast')).toBe(60);
    expect(pollSecondsFromEnv('2.5')).toBe(60);
  });

  it('reads the auto sync interval from the env: 60 by default, 0 turns it off', () => {
    expect(autoSyncMinutesFromEnv(undefined)).toBe(60);
    expect(autoSyncMinutesFromEnv('15')).toBe(15);
    expect(autoSyncMinutesFromEnv('0')).toBe(0);
    expect(autoSyncMinutesFromEnv('hourly')).toBe(60);
    // A run without the start sync gets no background sync either, unless it asks.
    expect(autoSyncMinutesFromEnv(undefined, false)).toBe(0);
    expect(autoSyncMinutesFromEnv('30', false)).toBe(30);
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
    await app.request(`/api/tiles/${encodeURIComponent('pr:acme/app#1')}/chat`, {
      headers: { [TOKEN_HEADER]: 'secret' },
    });
    expect(seen).toBe('pr:acme/app#1');
  });
});

describe('POST /api/telemetry', () => {
  const headers = { [TOKEN_HEADER]: 'secret', 'content-type': 'application/json' };

  it('forwards an allow-listed event with valid props', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const res = await app.request('/api/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'search_used', props: { query_length_bucket: 'short' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(telemetry.events).toEqual([{ event: 'search_used', props: { query_length_bucket: 'short' } }]);
  });

  it('refuses an event outside the renderer allow-list, even a real engine event', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const res = await app.request('/api/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'sync_completed', props: {} }),
    });
    expect(res.status).toBe(400);
    expect(telemetry.events).toEqual([]);
  });

  it('refuses an unknown event name', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const res = await app.request('/api/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'made_up_event', props: {} }),
    });
    expect(res.status).toBe(400);
    expect(telemetry.events).toEqual([]);
  });

  it('refuses props that do not match the event (extra or wrong-typed fields)', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const extra = await app.request('/api/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'search_used', props: { query_length_bucket: 'short', repo: 'acme/app' } }),
    });
    expect(extra.status).toBe(400);
    const wrongType = await app.request('/api/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'search_used', props: { query_length_bucket: 'a whole title here' } }),
    });
    expect(wrongType.status).toBe(400);
    expect(telemetry.events).toEqual([]);
  });

  it('hands a renderer error to captureRendererException, not to capture', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const props = { source: 'react_render', type: 'TypeError', message: 'boom', stack: 'TypeError: boom', chunk_ids: {} };
    const res = await app.request('/api/telemetry', { method: 'POST', headers, body: JSON.stringify({ event: 'renderer_exception', props }) });
    expect(res.status).toBe(200);
    expect(telemetry.rendererExceptions).toEqual([props]);
    expect(telemetry.events).toEqual([]);
  });

  it('refuses a renderer error with extra fields', async () => {
    const telemetry = new FakeTelemetry();
    const app = createApp(fakeEngine({}), 'secret', CONFIG, new UpdatesOff(''), telemetry);
    const props = { source: 'window_error', type: 'Error', message: 'boom', stack: null, chunk_ids: {}, pr_title: 'Fix login' };
    const res = await app.request('/api/telemetry', { method: 'POST', headers, body: JSON.stringify({ event: 'renderer_exception', props }) });
    expect(res.status).toBe(400);
    expect(telemetry.rendererExceptions).toEqual([]);
  });

  it('requires the token like every other route', async () => {
    const app = createApp(fakeEngine({}), 'secret', CONFIG);
    const res = await app.request('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'search_used', props: { query_length_bucket: 'short' } }),
    });
    expect(res.status).toBe(401);
  });
});
