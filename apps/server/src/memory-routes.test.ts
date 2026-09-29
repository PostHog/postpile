import { describe, expect, it } from 'vitest';
import type { ActionResult, ConsolidateOptions, ConsolidationReport, FactQuery, FactView, MemoryCorrection, PendingProposals } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const TOKEN = 'test-token';

interface Recorded {
  factQueries: FactQuery[];
  consolidateOptions: ConsolidateOptions[];
  corrections: MemoryCorrection[];
}

/** The sample FakeEngine, but remembering what the routes passed to the memory calls. */
function setup(): { recorded: Recorded; request: (path: string, init?: RequestInit) => Promise<Response> } {
  const recorded: Recorded = { factQueries: [], consolidateOptions: [], corrections: [] };
  const fake = new FakeEngine({ syncStepMs: 0 });
  const engine = Object.assign(fake, {
    listFacts: async (query: FactQuery): Promise<FactView[]> => {
      recorded.factQueries.push(query);
      return [];
    },
    correctMemory: async (input: MemoryCorrection): Promise<ActionResult> => {
      recorded.corrections.push(input);
      return FakeEngine.prototype.correctMemory.call(fake, input);
    },
    consolidate: async (options: ConsolidateOptions = {}): Promise<ConsolidationReport> => {
      recorded.consolidateOptions.push(options);
      return FakeEngine.prototype.consolidate.call(fake);
    },
  });
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60 });
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined), [TOKEN_HEADER]: TOKEN };
    return app.request(path, { ...init, headers });
  };
  return { recorded, request };
}

describe('engine memory routes', () => {
  it('turns fact query params into a FactQuery', async () => {
    const { recorded, request } = setup();

    const res = await request('/api/facts?entity=path:acme/app:.github/workflows/&since=2026-09-01T10:00:00%2B02:00&includeClosed=true&limit=5');

    expect(res.status).toBe(200);
    expect(recorded.factQueries).toEqual([
      {
        entity: { kind: 'path', key: 'acme/app:.github/workflows/' },
        changedSince: '2026-09-01T08:00:00.000Z',
        includeClosed: true,
        limit: 5,
      },
    ]);
  });

  it('answers 400 for a malformed entity', async () => {
    const { request } = setup();
    expect((await request('/api/facts?entity=alice')).status).toBe(400);
  });

  it('lists proposals, decides rule proposals and marks a topic seen', async () => {
    const { request } = setup();

    const proposals = (await (await request('/api/proposals')).json()) as PendingProposals;
    expect(proposals.rules.map((rule) => rule.id)).toEqual(['rule-bot-bumps']);
    expect(proposals.topics.length).toBeGreaterThan(0);

    const unknown = await request('/api/rule-proposals/r1', { method: 'POST', body: JSON.stringify({ accept: true }) });
    expect(((await unknown.json()) as ActionResult).ok).toBe(false);
    const decided = await request('/api/rule-proposals/rule-bot-bumps', { method: 'POST', body: JSON.stringify({ accept: true }) });
    expect(((await decided.json()) as ActionResult).ok).toBe(true);

    const seen = await request('/api/topics/topic-depot/seen', { method: 'POST' });
    expect(((await seen.json()) as ActionResult).ok).toBe(true);
  });

  it('takes memory corrections and rejects an unknown kind', async () => {
    const { request } = setup();

    const body = { kind: 'wrong', factId: 'fact-rowan-drives', text: 'rowan drives the move to Depot.' };
    const corrected = await request('/api/memory/corrections', { method: 'POST', body: JSON.stringify(body) });
    const bad = await request('/api/memory/corrections', { method: 'POST', body: JSON.stringify({ ...body, kind: 'delete' }) });

    expect(((await corrected.json()) as ActionResult).ok).toBe(true);
    expect(bad.status).toBe(400);
  });

  it('passes fromRecheck through, so an accepted recheck reaches telemetry', async () => {
    const { recorded, request } = setup();

    const body = { kind: 'confirm', factId: 'fact-rowan-drives', text: 'rowan drives the move to Depot.', fromRecheck: true };
    await request('/api/memory/corrections', { method: 'POST', body: JSON.stringify(body) });

    expect(recorded.corrections[0]).toMatchObject({ kind: 'confirm', fromRecheck: true });
  });

  it('consolidates with or without a body', async () => {
    const { recorded, request } = setup();

    await request('/api/consolidate', { method: 'POST' });
    await request('/api/consolidate', { method: 'POST', body: JSON.stringify({ onlyIfDue: true, maxAgentCalls: 2 }) });

    expect(recorded.consolidateOptions).toEqual([{ maxAgentCalls: 30 }, { onlyIfDue: true, maxAgentCalls: 2 }]);
  });

  it('accepts the dossiers job on sync and rejects the old summaries job', async () => {
    const { request } = setup();
    const ok = await request('/api/sync', { method: 'POST', body: JSON.stringify({ agentJobs: ['dossiers'] }) });
    const bad = await request('/api/sync', { method: 'POST', body: JSON.stringify({ agentJobs: ['summaries'] }) });
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(400);
  });
});
