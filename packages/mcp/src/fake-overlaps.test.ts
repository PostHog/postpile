import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeEngine } from '@postpile/server';
import { describe, expect, it } from 'vitest';
import { InMemoryAgentRequests } from './agent-requests.ts';
import { createMcpServer } from './server.ts';

/** MCP over the sample with POSTPILE_FAKE_EXTRA=mcp, which has diffs to compare. */
async function connected(): Promise<Client> {
  const engine = new FakeEngine({ setupStepMs: 0, syncStepMs: 0, extras: new Set(['mcp']) });
  const server = createMcpServer(engine, { version: 'test', appRunning: () => true, requests: new InMemoryAgentRequests(engine) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: 'test' });
  await client.connect(clientSide);
  return client;
}

async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return (result.content as { text: string }[]).map((part) => part.text).join('\n');
}

describe('overlapping edits on the mcp sample pack', () => {
  it('names the PR on the same lines in pr_context, with what it means outside the data', async () => {
    const text = await callText(await connected(), 'pr_context', { pr: 'acme/app#1902' });
    expect(text).toContain('Also edits the same lines: acme/app#2301 by sol, .github/workflows/ci-backend.yml');
    expect(text).toContain('Whichever merges second can drop or undo lines of the first');
    expect(text).not.toContain('acme/app#1911 by rowan, .github');
  });

  it('marks queue rows with overlaps and near, never a lockfile pair', async () => {
    const text = await callText(await connected(), 'whats_on_me', { whose_move: 'any', limit: 100 });
    expect(text).toContain('overlaps #2301');
    expect(text).not.toMatch(/near #1921|near #1904/);
  });

  it('says a capped diff may overlap more', async () => {
    const text = await callText(await connected(), 'pr_context', { pr: 'acme/app#1934' });
    expect(text).toContain('May overlap more (diff capped)');
  });
});
