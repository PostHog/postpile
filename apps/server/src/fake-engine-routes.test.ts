import { describe, expect, it } from 'vitest';
import type { AppConfig, ViewerView } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const TOKEN = 'test-token';

function config(fake: boolean): AppConfig {
  return { fake, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 };
}

function post(fake: boolean, path: string, body: unknown, token = TOKEN) {
  const app = createApp(new FakeEngine({ setupStepMs: 0, syncStepMs: 0 }), TOKEN, config(fake));
  return app.request(path, { method: 'POST', headers: { [TOKEN_HEADER]: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('shared engine route on sample data', () => {
  it('answers an allowed engine method with its result', async () => {
    const response = await post(true, '/api/fake/engine/getViewer', { args: [] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ViewerView };
    expect(body.result.login).toBe('you');
  });

  it('refuses methods outside the MCP list, and a call without the token', async () => {
    expect((await post(true, '/api/fake/engine/markRead', { args: ['tile'] })).status).toBe(400);
    expect((await post(true, '/api/fake/engine/getViewer', { args: [] }, 'wrong')).status).toBe(401);
  });

  it('does not exist outside fake mode', async () => {
    expect((await post(false, '/api/fake/engine/getViewer', { args: [] })).status).toBe(404);
  });
});
