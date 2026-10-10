import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { PendingProposals, PrDetail } from '@postpile/core';
import { FakeEngine, startServer, TOKEN_HEADER, UpdatesOff, type RunningServer } from '@postpile/server';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAgentRequests } from './agent-requests.ts';
import { RemoteEngine } from './remote-engine.ts';
import { createMcpServer } from './server.ts';

const TOKEN = 'test-token';
const CONFIG = { fake: true, syncCallCap: 30, syncOnStart: false, profile: 'default', databasePath: null, autoSyncMinutes: 0 } as const;

let running: RunningServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

async function fakeServer(fake = true): Promise<RunningServer> {
  running = await startServer({ engine: new FakeEngine({ setupStepMs: 0, syncStepMs: 0 }), port: 0, token: TOKEN, config: { ...CONFIG, fake }, updates: new UpdatesOff('') });
  return running;
}

/** An MCP client on top of the server's engine, like `pnpm cli mcp --api <url>`. */
async function mcpOver(server: RunningServer): Promise<Client> {
  const engine = new RemoteEngine(server.url, TOKEN);
  const mcp = createMcpServer(engine, { version: 'test', appRunning: () => true, requests: new InMemoryAgentRequests(engine) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  const client = new Client({ name: 'claude-code', version: 'test' });
  await client.connect(clientSide);
  return client;
}

async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content.map((part) => part.text).join('\n'), isError: result.isError === true };
}

/** What the renderer reads, through the same API. */
async function api<T>(server: RunningServer, path: string): Promise<T> {
  const response = await fetch(`${server.url}${path}`, { headers: { [TOKEN_HEADER]: TOKEN } });
  return (await response.json()) as T;
}

describe('MCP over a fake server engine', () => {
  it('files a topic suggestion the server API (and so the Inbox) shows', async () => {
    const server = await fakeServer();
    const client = await mcpOver(server);
    const before = await api<PendingProposals>(server, '/api/proposals');

    const filed = await callText(client, 'propose_topic_change', { topic: 'topic-dev-env', kind: 'rename', name: 'Devbox and dev env', reason: 'Most PRs are about the devbox' });
    expect(filed.isError).toBe(false);

    const after = await api<PendingProposals>(server, '/api/proposals');
    expect(after.topics.length).toBe(before.topics.length + 1);
    expect(JSON.stringify(after.topics)).toContain('Devbox and dev env');
  });

  it('sets a PR note the PR pane reads, and reads a note the UI cleared', async () => {
    const server = await fakeServer();
    const client = await mcpOver(server);
    const context = await callText(client, 'pr_context', { pr: 'acme/app#1870' });
    const token = /Observation token for note_pr: (\S+) /.exec(context.text)?.[1];
    expect(token).toBeTruthy();

    const set = await callText(client, 'note_pr', { pr: 'acme/app#1870', kind: 'no_action', note: 'Only renames env vars.', by: 'test session', token });
    expect(set.isError).toBe(false);
    const pr = await api<PrDetail>(server, '/api/prs/acme/app/1870');
    expect(pr.notes.durable?.note).toBe('Only renames env vars.');

    const cleared = await fetch(`${server.url}/api/pr-notes/${encodeURIComponent(pr.notes.durable?.id ?? '')}/clear`, { method: 'POST', headers: { [TOKEN_HEADER]: TOKEN } });
    expect(cleared.status).toBe(200);
    expect((await callText(client, 'pr_context', { pr: 'acme/app#1870' })).text).not.toContain('Only renames env vars.');
  });

  it('says so when the server has no shared engine', async () => {
    const server = await fakeServer(false);
    const client = await mcpOver(server);
    const answer = await callText(client, 'whats_on_me', {});
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('has no shared engine; only a server started with POSTPILE_FAKE=1 has one');
  });

  it('says so when the server is not running', async () => {
    const engine = new RemoteEngine('http://127.0.0.1:9', TOKEN);
    await expect(engine.getViewer()).rejects.toThrow('the fake server at http://127.0.0.1:9 is not reachable');
  });
});
