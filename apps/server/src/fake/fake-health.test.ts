// Health and first-run states in fake mode match the real engine: an offline
// sync fails with its error, a first run is empty until its first sync, the
// setup draft fails without claude, and sync phases fit inside the run.
import { describe, expect, it } from 'vitest';
import { fakeLiveFromEnv } from '../engine-from-env.ts';
import { FakeEngine, type FakeEngineOptions } from './fake-engine.ts';

function engine(options: FakeEngineOptions = {}): FakeEngine {
  return new FakeEngine({ syncStepMs: 0, setupStepMs: 0, ...options });
}

async function settledSweep(fake: FakeEngine) {
  await fake.startSetupSweep();
  for (let i = 0; i < 50; i += 1) {
    const view = await fake.setupSweep();
    if (view && !view.running) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the sweep did not finish');
}

describe('fake GitHub health', () => {
  it('fails the sync with the fetch error while GitHub cannot be reached, and keeps that report', async () => {
    const fake = engine({ missingTools: ['gh-offline'] });
    const report = await fake.sync();
    expect(report.errors).toEqual(['sync: fetch failed (sample data: GitHub cannot be reached)']);
    expect(report.agentCalls).toBe(0);
    expect((await fake.lastSyncReport())?.errors).toHaveLength(1);
    await expect(fake.pollOnce()).rejects.toThrow('fetch failed');
  });

  it('runs a sync the user asked for anyway while the quota is nearly used, like the engine', async () => {
    const report = await engine({ quota: 'critical' }).sync();
    expect(report).toMatchObject({ errors: [], agentCalls: 4 });
  });

  it('starts the standalone live poll for the health switches the real app shows through it', () => {
    expect(fakeLiveFromEnv({})).toBe(false);
    expect(fakeLiveFromEnv({ POSTPILE_FAKE_LIVE: '1' })).toBe(true);
    expect(fakeLiveFromEnv({ POSTPILE_FAKE_QUOTA: 'critical' })).toBe(true);
    expect(fakeLiveFromEnv({ POSTPILE_FAKE_MISSING: 'claude,gh-offline' })).toBe(true);
    expect(fakeLiveFromEnv({ POSTPILE_FAKE_MISSING: 'gh-offline', POSTPILE_FAKE_LIVE: '0' })).toBe(false);
  });
});

describe('fake first run', () => {
  it('has no board, proposals or unread PRs until the first sync, and no last sync report', async () => {
    const fake = engine({ forceSetup: true });
    expect(await fake.listTopics()).toEqual([]);
    expect(await fake.listProposals()).toEqual({ topics: [], rules: [] });
    expect(await fake.getTopic('topic-depot')).toBeNull();
    expect(await fake.unreadPrKeys()).toEqual([]);
    expect(await fake.lastSyncReport()).toBeNull();

    await fake.sync();
    expect((await fake.listTopics()).length).toBeGreaterThan(0);
    expect((await fake.listProposals()).topics.length).toBeGreaterThan(0);
  });

  it('stays empty while gh is missing, since no sync can run', async () => {
    const fake = engine({ missingTools: ['gh'] });
    expect((await fake.sync()).blockedBy).not.toBeNull();
    expect(await fake.listProposals()).toEqual({ topics: [], rules: [] });
    expect(await fake.lastSyncReport()).toBeNull();
  });

  it('reports the sync the sample was fetched by otherwise, a few minutes before start', async () => {
    const now = new Date('2026-09-27T10:00:00Z');
    const report = await engine({ now: () => now }).lastSyncReport();
    expect(report?.finishedAt).toBe('2026-09-27T09:56:00.000Z');
  });
});

describe('fake setup draft without claude', () => {
  it('fails the draft line into the engine\'s blank draft', async () => {
    const view = await settledSweep(engine({ forceSetup: true, missingTools: ['claude-auth'] }));
    expect(view.lines.at(-1)).toMatchObject({ step: 'draft', state: 'failed' });
    expect(view.error).toMatch(/^The agent could not write a draft: /);
    expect(view.draft).toMatchObject({ model: null, summary: 'No agent draft this time. Start from these headings and write it in your words.' });
    expect(view.draft?.sections.every((section) => section.claims.length === 0)).toBe(true);
  });

  it('writes the sample draft with claude', async () => {
    const view = await settledSweep(engine({ forceSetup: true }));
    expect(view.error).toBeNull();
    expect(view.draft?.model).toBe('opus');
  });
});

describe('fake sync phases', () => {
  it('reports phase times that fit inside the run', async () => {
    const report = await new FakeEngine({ syncStepMs: 10 }).sync();
    const runMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    const phases = Object.values(report.phaseMs ?? {});
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.every((ms) => ms <= runMs)).toBe(true);
  });
});
