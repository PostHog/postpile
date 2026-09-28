import { describe, expect, it } from 'vitest';
import type { SetupChecksView, SyncReport, ToolsView, TopicListItem } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';
import { fakeToolProblems, type FakeToolProblem } from './fake/fake-tools.ts';

const TOKEN = 'test-token';

function appWith(missingTools: FakeToolProblem[]) {
  const engine = new FakeEngine({ missingTools, setupStepMs: 0, syncStepMs: 0 });
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null });
  return async <T>(path: string, method = 'GET'): Promise<T> => {
    const response = await app.request(path, { method, headers: { [TOKEN_HEADER]: TOKEN } });
    return (await response.json()) as T;
  };
}

describe('fakeToolProblems', () => {
  it('reads the comma list, drops unknown words and repeats', () => {
    expect(fakeToolProblems('gh, Claude-Limit,nope,gh')).toEqual(['gh', 'claude-limit']);
    expect(fakeToolProblems(undefined)).toEqual([]);
    expect(fakeToolProblems('')).toEqual([]);
  });
});

describe('tool routes on sample data', () => {
  it('says all is well by default', async () => {
    const call = appWith([]);
    expect(await call<ToolsView>('/api/tools')).toMatchObject({ canSync: true, agentOn: true, nextCheckAt: null, gh: { state: 'ok' }, claude: { state: 'ok' } });
  });

  it('without gh: no topics, a skipped sync, a paused poll and failing setup checks', async () => {
    const call = appWith(['gh']);

    const tools = await call<ToolsView>('/api/tools');
    expect(tools).toMatchObject({ canSync: false, gh: { state: 'missing', headline: 'GitHub CLI (gh) not found' } });
    expect(tools.gh.fixes.map((fix) => fix.command)).toEqual(['brew install gh', 'gh auth login']);
    expect(await call<TopicListItem[]>('/api/topics')).toEqual([]);
    expect(await call<SyncReport>('/api/sync', 'POST')).toMatchObject({ blockedBy: 'GitHub CLI (gh) not found', errors: [] });
    const checks = await call<SetupChecksView>('/api/setup/checks');
    expect(checks.checks.map((check) => check.state)).toEqual(['fail', 'skipped', 'skipped', 'ok']);
    expect(checks.canContinue).toBe(false);
    expect((await call<ToolsView>('/api/tools/check', 'POST')).gh.state).toBe('missing');
  });

  it('without claude: sample topics, a sync on rules only and agent actions refused', async () => {
    const call = appWith(['claude']);

    expect(await call<ToolsView>('/api/tools')).toMatchObject({ canSync: true, agentOn: false, claude: { headline: 'Agent features are off: claude not found' } });
    expect((await call<TopicListItem[]>('/api/topics')).length).toBeGreaterThan(0);
    expect(await call<SyncReport>('/api/sync', 'POST')).toMatchObject({ agentOff: 'Agent features are off: claude not found', agentCalls: 0, errors: [] });
  });

  it('with a refused token: the topics stay, the sync is skipped', async () => {
    const call = appWith(['gh-token']);
    expect((await call<TopicListItem[]>('/api/topics')).length).toBeGreaterThan(0);
    expect(await call<SyncReport>('/api/sync', 'POST')).toMatchObject({ blockedBy: 'GitHub did not accept the gh login' });
  });

  it('with a usage limit: the retry time is on the wire', async () => {
    const call = appWith(['claude-limit']);
    const tools = await call<ToolsView>('/api/tools');
    expect(tools.claude).toMatchObject({ state: 'limited', headline: 'Agent features are paused: Claude usage limit reached' });
    expect(tools.claude.retryAt).not.toBeNull();
  });
});
