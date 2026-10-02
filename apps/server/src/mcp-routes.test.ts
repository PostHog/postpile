import { describe, expect, it } from 'vitest';
import type { ActionResult, McpConnectionView } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';
import type { FakeToolProblem } from './fake/fake-tools.ts';

const TOKEN = 'test-token';

function appWith(missingTools: FakeToolProblem[] = []) {
  const engine = new FakeEngine({ missingTools, setupStepMs: 0, syncStepMs: 0 });
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60, install: 'app' });
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: T }> => {
    const headers: Record<string, string> = { [TOKEN_HEADER]: TOKEN };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: (await response.json()) as T };
  };
}

describe('MCP connection routes on sample data', () => {
  it('starts not connected and "adds" it in memory on a click', async () => {
    const call = appWith();

    const before = await call<McpConnectionView>('/api/mcp-connection');
    expect(before.json).toMatchObject({ state: 'not_connected', blockedReason: null, hidden: false });
    expect(before.json.addCommand).toBe('claude mcp add --scope user postpile -- /Applications/PostPile.app/Contents/Resources/postpile-mcp');

    const added = await call<ActionResult>('/api/mcp-connection', 'POST', { from: 'footer' });
    expect(added.json.ok).toBe(true);
    expect((await call<McpConnectionView>('/api/mcp-connection')).json.state).toBe('connected');
  });

  it('keeps "Not now"', async () => {
    const call = appWith();
    expect((await call<ActionResult>('/api/mcp-connection/not-now', 'POST')).json.ok).toBe(true);
    expect((await call<McpConnectionView>('/api/mcp-connection')).json.hidden).toBe(true);
  });

  it('refuses a click from an unknown place', async () => {
    const call = appWith();
    expect((await call('/api/mcp-connection', 'POST', { from: 'menu' })).status).toBe(400);
  });

  it('stays unknown without claude, so the footer does not ask', async () => {
    const call = appWith(['claude']);
    const view = await call<McpConnectionView>('/api/mcp-connection');
    expect(view.json.state).toBe('unknown');
    expect(view.json.blockedReason).not.toBeNull();
    expect((await call<ActionResult>('/api/mcp-connection', 'POST', { from: 'setup' })).json.ok).toBe(false);
  });
});
