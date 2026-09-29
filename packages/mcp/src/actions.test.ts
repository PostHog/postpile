import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeEngine } from '@postpile/server';
import { describe, expect, it } from 'vitest';
import { FileAgentRequests, InMemoryAgentRequests, type AgentRequests } from './agent-requests.ts';
import { clientName, createMcpServer, type McpToolName } from './server.ts';

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown> | undefined;
}

async function connected(engine = new FakeEngine(), requests: AgentRequests = new InMemoryAgentRequests(engine), onToolCall?: (tool: McpToolName) => void): Promise<Client> {
  const server = createMcpServer(engine, { version: 'test', appRunning: () => true, requests, onToolCall });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'claude-code', version: 'test' });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Called> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content.map((part) => part.text).join('\n'), isError: result.isError === true, structured: result.structuredContent as Record<string, unknown> | undefined };
}

describe('refresh_from_github', () => {
  it('re-reads a PR through the app, then skips it as fresh', async () => {
    const tools: McpToolName[] = [];
    const client = await connected(undefined, undefined, (tool) => tools.push(tool));
    const first = await call(client, 'refresh_from_github', { pr: 'acme/app#1902' });
    expect(first.isError).toBe(false);
    expect(first.text).toContain('Re-read from GitHub: 1 of 1 PRs (acme/app#1902).');
    expect(first.text).toContain('The glance and dossier may update in the background');
    expect(first.structured).toEqual({ status: 'refreshed', prs: 1, fetched: 1, changed: 0, skipped_fresh: 0 });
    expect((await call(client, 'pr_context', { pr: '#1902' })).text).toMatch(/PostPile fetched this PR from GitHub (just now|\d+ s ago)/);

    const second = await call(client, 'refresh_from_github', { pr: '#1902' });
    expect(second.structured).toMatchObject({ status: 'all_fresh', fetched: 0, skipped_fresh: 1 });
    expect(second.text).toContain('Skipped as fresh: acme/app#1902');
    expect(tools).toEqual(['refresh_from_github', 'pr_context', 'refresh_from_github']);
  });

  it('refreshes a topic by name', async () => {
    const client = await connected();
    const result = await call(client, 'refresh_from_github', { topic: 'depot' });
    expect(result.structured).toMatchObject({ status: 'refreshed' });
    expect(Number(result.structured?.prs)).toBeGreaterThan(1);
  });

  it('wants exactly one of pr or topic, and a PR PostPile tracks', async () => {
    const client = await connected();
    for (const args of [{}, { pr: '#1902', topic: 'depot' }]) {
      const result = await call(client, 'refresh_from_github', args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Pass exactly one of pr or topic. Examples: refresh_from_github(pr: "acme/app#1902")');
    }
    expect((await call(client, 'refresh_from_github', { pr: 'acme/app#999999' })).text).toContain('PostPile tracks no PR acme/app#999999');
  });

  it('says the app is not running and writes nothing', async () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'postpile-mcp-')), 'agent-requests');
    const client = await connected(undefined, new FileAgentRequests({ folder, appRunning: () => false }));
    const result = await call(client, 'refresh_from_github', { pr: 'acme/app#1902' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('PostPile is not running, nothing was done.');
    expect(result.text).toContain('Continue with the stored data or ask the user to open PostPile.');
  });

  it('passes on a refusal with when to try again', async () => {
    const client = await connected(new FakeEngine({ quota: 'critical' }));
    const result = await call(client, 'refresh_from_github', { pr: 'acme/app#1902' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Nothing was read from GitHub: .*nearly used.* Try again after \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Go on with the stored data\./);
  });

  it('says a refresh is still running when the app took it but did not answer in time', async () => {
    const slow: AgentRequests = { ask: async () => ({ kind: 'timeout', taken: true }) };
    const client = await connected(undefined, slow);
    const result = await call(client, 'refresh_from_github', { pr: 'acme/app#1902' });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('PostPile is still reading GitHub after 20 s. Read pr_context again in a minute.');
    expect(result.structured).toMatchObject({ status: 'running' });
  });
});

describe('propose_topic_change', () => {
  const split = { topic: 'depot', kind: 'split', prs: ['#1902'], name: 'Depot stack', reason: 'The stack is its own piece of work.' };

  it('previews a split with its stack, fenced, and files nothing on a dry run', async () => {
    const engine = new FakeEngine();
    const client = await connected(engine);
    const result = await call(client, 'propose_topic_change', { ...split, dry_run: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Dry run: nothing was filed.');
    expect(result.text).toMatch(/<postpile-data id="[0-9a-f]{8}">\nSplit 5 PRs out of "Move CI to Depot" into a new topic "Depot stack"/);
    expect(result.text).toContain('acme/app#1902 brings acme/app#1851, acme/app#1862, acme/app#1911 and acme/app#1930 along (same stack).');
    expect(result.structured).toEqual({ status: 'dry_run', proposal_id: null, prs_moved: 5 });
    expect((await engine.listProposals()).topics.map((proposal) => proposal.source)).toEqual(['consolidation', 'consolidation', 'agent']);
  });

  it('files a suggestion under the client name, shows it on the topic and refuses a repeat', async () => {
    const engine = new FakeEngine();
    const client = await connected(engine);
    const filed = await call(client, 'propose_topic_change', split);
    expect(filed.text).toContain('Filed as a suggestion for the user');
    expect(filed.structured).toMatchObject({ status: 'filed', prs_moved: 5 });
    const proposal = (await engine.listProposals()).topics.find((candidate) => candidate.id === filed.structured?.proposal_id);
    expect(proposal).toMatchObject({ kind: 'split', source: 'agent', client: 'claude-code', topicId: 'topic-depot', prKeys: ['acme/app#1902'] });

    const topic = await call(client, 'topic', { topic: 'topic-depot' });
    expect(topic.text).toMatch(/pending since \d{4}-\d\d-\d\d: split "Depot stack" out \(acme\/app#1902\), suggested by claude-code\. Reason: The stack is its own piece of work\./);

    const again = await call(client, 'propose_topic_change', split);
    expect(again.isError).toBe(true);
    expect(again.text).toContain('Not filed: The same change is pending already');
  });

  it('shows a decided suggestion on the topic afterwards', async () => {
    const engine = new FakeEngine();
    const client = await connected(engine);
    await engine.decideTopicProposal('proposal-rename-dev-env', false);
    expect((await call(client, 'topic', { topic: 'topic-dev-env', detail: 'full' })).text).toMatch(/rejected on \d{4}-\d\d-\d\d: rename to "Dev env and devbox", from PostPile's consolidation/);
    const retry = await call(client, 'propose_topic_change', { topic: 'topic-dev-env', kind: 'rename', name: 'Dev env and devbox', reason: 'clearer' });
    expect(retry.text).toContain("don't propose it again");
  });

  it('asks for what each kind needs, with an example', async () => {
    const client = await connected();
    const noName = await call(client, 'propose_topic_change', { topic: 'depot', kind: 'rename', reason: 'r' });
    expect(noName.isError).toBe(true);
    expect(noName.text).toContain('rename needs name: the new name. Example: propose_topic_change(topic: "depot", kind: "rename"');
    expect((await call(client, 'propose_topic_change', { topic: 'depot', kind: 'split', name: 'x', reason: 'r' })).text).toContain('split needs prs');
    expect((await call(client, 'propose_topic_change', { topic: 'depot', kind: 'merge', reason: 'r' })).text).toContain('merge needs into_topic');
    const noReason = await call(client, 'propose_topic_change', { topic: 'depot', kind: 'rename', name: 'x', reason: '' });
    expect(noReason.isError).toBe(true);
    expect(noReason.text).toContain('reason is required');
    const outside = await call(client, 'propose_topic_change', { topic: 'depot', kind: 'split', prs: ['acme/app#1822'], name: 'x', reason: 'r' });
    expect(outside.text).toContain('acme/app#1822 is not in "Move CI to Depot"');
  });

  it('merges into another topic found by name', async () => {
    const client = await connected();
    const result = await call(client, 'propose_topic_change', { topic: 'frontend', kind: 'merge', into_topic: 'migrations', reason: 'same people', dry_run: true });
    expect(result.text).toContain('Merge "Frontend build" (2 PRs) into "Migrations"; "Frontend build" is archived.');
  });
});

describe('clientName', () => {
  it('keeps a plain name and drops the rest', () => {
    expect(clientName('claude-code')).toBe('claude-code');
    expect(clientName('evil\u202e<b>name</b>')).toBe('evilbnameb');
    expect(clientName(undefined)).toBe('unknown');
    expect(clientName('x'.repeat(100))).toHaveLength(64);
  });
});
