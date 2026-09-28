import { describe, expect, it } from 'vitest';
import type { InstructionsView, RepoOverview, SetupAcceptResult, SetupChecksView, SetupRefineResult, SetupStatus, SetupSweepView } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';

const TOKEN = 'test-token';

function appWith(engine: FakeEngine) {
  const app = createApp(engine, TOKEN, { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null });
  return async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> => {
    const headers: Record<string, string> = { [TOKEN_HEADER]: TOKEN };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await app.request(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: response.status, json: (await response.json()) as T };
  };
}

async function finishedSweep(call: ReturnType<typeof appWith>): Promise<SetupSweepView> {
  await call('/api/setup/sweep', { method: 'POST' });
  for (let i = 0; i < 100; i++) {
    const { json } = await call<SetupSweepView | null>('/api/setup/sweep');
    if (json && !json.running) {
      return json;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('the fake sweep did not finish');
}

describe('setup routes on sample data', () => {
  it('walks the whole flow when POSTPILE_FAKE_SETUP forces it', async () => {
    const call = appWith(new FakeEngine({ forceSetup: true, setupStepMs: 0, syncStepMs: 0 }));

    expect((await call<SetupStatus>('/api/setup')).json).toMatchObject({ needed: true, flag: null, hasInstructions: false });
    expect((await call<SetupChecksView>('/api/setup/checks')).json).toMatchObject({ canContinue: true, agentAvailable: true, login: 'you' });
    expect((await call<SetupSweepView | null>('/api/setup/sweep')).json).toBeNull();

    const sweep = await finishedSweep(call);
    expect(sweep.lines.map((line) => line.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(sweep.current).toEqual({ text: '', version: null });
    const draft = sweep.draft!;
    expect(draft.sections.map((section) => section.heading)).toEqual(['About me', 'What I own', 'What gets routed to me', 'What to ignore or keep quiet', 'Preferences']);
    expect(draft.mainRepo?.repo).toBe('PostHog/posthog');
    expect(draft.quietRepos.map((repo) => repo.repo)).toEqual(['PostHog/posthog-desktop', 'PostHog/posthog-python']);
    // Every cited id resolves to a source the "Why?" panel can show.
    const ids = new Set(draft.sources.map((source) => source.id));
    expect(draft.sections.flatMap((section) => section.claims.flatMap((claim) => claim.sourceIds)).every((id) => ids.has(id))).toBe(true);

    const sections = draft.sections.map((section) => ({ heading: section.heading, body: section.body }));
    const refined = (await call<SetupRefineResult>('/api/setup/refine', { method: 'POST', body: { sections, message: 'Ping me for release workflow changes' } })).json;
    expect(refined).toMatchObject({ ok: true, changedSections: ['Preferences'] });
    expect(refined.draft?.sections.at(-1)?.claims.at(-1)).toEqual({ text: 'Ping me for release workflow changes', sourceIds: [], fromUser: true });

    const accept = {
      sections: refined.draft!.sections.map((section) => ({ heading: section.heading, body: section.body })),
      quietRepos: ['PostHog/posthog-desktop'],
      mainRepo: 'PostHog/posthog',
      baseVersion: null,
    };
    const accepted = (await call<SetupAcceptResult>('/api/setup/accept', { method: 'POST', body: accept })).json;
    expect(accepted).toMatchObject({ ok: true, savedVersion: 1 });

    const instructions = (await call<InstructionsView>('/api/instructions')).json;
    expect(instructions.versions[0]).toMatchObject({ version: 1, origin: 'setup', summary: 'Written with setup' });
    expect(instructions.text).toContain('# About me\n- I work on developer experience');
    const repos = (await call<RepoOverview>('/api/repos')).json;
    expect(repos.scope).toBe('PostHog/posthog');
    expect(repos.repos.filter((repo) => repo.quiet).map((repo) => repo.repo)).toEqual(['PostHog/posthog-desktop']);
    expect((await call<SetupStatus>('/api/setup')).json).toMatchObject({ needed: false, flag: 'done', hasInstructions: true });
  });

  it('shows a re-run against the sample instructions and refuses a stale base', async () => {
    const call = appWith(new FakeEngine({ setupStepMs: 0, syncStepMs: 0 }));
    expect((await call<SetupStatus>('/api/setup')).json).toMatchObject({ needed: false, hasInstructions: true });

    const sweep = await finishedSweep(call);
    expect(sweep.current.version).toBe(3);
    const sections = sweep.draft!.sections.map((section) => ({ heading: section.heading, body: section.body }));

    const stale = (await call<SetupAcceptResult>('/api/setup/accept', { method: 'POST', body: { sections, baseVersion: 2 } })).json;
    expect(stale).toMatchObject({ ok: false, savedVersion: null, current: { version: 3 } });

    const accepted = (await call<SetupAcceptResult>('/api/setup/accept', { method: 'POST', body: { sections, baseVersion: 3 } })).json;
    expect(accepted).toMatchObject({ ok: true, savedVersion: 4 });
  });

  it('skips, and refuses bad bodies', async () => {
    const call = appWith(new FakeEngine({ forceSetup: true, setupStepMs: 0 }));
    expect((await call('/api/setup/skip', { method: 'POST' })).json).toMatchObject({ ok: true });
    expect((await call<SetupStatus>('/api/setup')).json).toMatchObject({ needed: false, flag: 'skipped' });
    expect((await call('/api/setup/accept', { method: 'POST', body: { sections: [], quietRepos: ['nope'], baseVersion: null } })).status).toBe(400);
    expect((await call('/api/setup/refine', { method: 'POST', body: { sections: [], message: '' } })).status).toBe(400);
  });
});
