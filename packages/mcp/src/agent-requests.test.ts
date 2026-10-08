import { existsSync, mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRequestInbox, answerAgentRequest } from '@postpile/engine';
import { FakeEngine } from '@postpile/server';
import { describe, expect, it } from 'vitest';
import { FileAgentRequests, InMemoryAgentRequests } from './agent-requests.ts';

function folder(): string {
  return join(mkdtempSync(join(tmpdir(), 'postpile-outbox-')), 'agent-requests');
}

const REFRESH = { kind: 'refresh', payload: { kind: 'pr', prKey: 'acme/app#1902' } } as const;

describe('FileAgentRequests', () => {
  it('writes nothing when the app is not running', async () => {
    const dir = folder();
    const outbox = new FileAgentRequests({ folder: dir, appRunning: () => false });
    expect(await outbox.ask(REFRESH, 'claude-code')).toEqual({ kind: 'not_running' });
    expect(existsSync(dir)).toBe(false);
  });

  it('gets the answer of the running app through the folder', async () => {
    const dir = folder();
    const engine = new FakeEngine();
    const app = new AgentRequestInbox({ folder: dir, handle: (request) => answerAgentRequest(engine, request), log: () => {}, rescanMs: 20 });
    app.start();
    try {
      const outbox = new FileAgentRequests({ folder: dir, appRunning: () => true, pollMs: 10 });
      const outcome = await outbox.ask(REFRESH, 'claude-code');
      expect(outcome).toMatchObject({ kind: 'answered', result: { ok: true, kind: 'refresh', refresh: { status: 'done', fetched: ['acme/app#1902'] } } });
      expect((await engine.actionLog(1))[0]?.detail).toContain('claude-code:');
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      app.stop();
    }
  });

  it('carries note_pr both ways: a retry writes once, a token from an older state is refused', async () => {
    const dir = folder();
    const engine = new FakeEngine();
    const app = new AgentRequestInbox({ folder: dir, handle: (request) => answerAgentRequest(engine, request), log: () => {}, rescanMs: 20 });
    app.start();
    try {
      const outbox = new FileAgentRequests({ folder: dir, appRunning: () => true, pollMs: 10 });
      const token = (await engine.getPr('acme/app#1902'))?.notes.token ?? '';
      const payload = { action: 'set', prKey: 'acme/app#1902', kind: 'no_action', note: 'nothing to do', by: 'ph3 session', token, coveredByPrKey: null, coverToken: null, leaseMinutes: null } as const;

      const first = await outbox.ask({ kind: 'note_pr', payload }, 'claude-code');
      expect(first).toMatchObject({ kind: 'answered', result: { ok: true, kind: 'note_pr', prNote: { status: 'set' } } });
      const retry = await outbox.ask({ kind: 'note_pr', payload }, 'claude-code');
      expect(retry).toMatchObject({ kind: 'answered', result: { ok: true, kind: 'note_pr', prNote: { status: 'unchanged' } } });
      expect((await engine.listPrNotes(['acme/app#1902']))[0]?.durable?.client).toBe('claude-code');

      const old = await outbox.ask({ kind: 'note_pr', payload: { ...payload, token: 'older' } }, 'claude-code');
      expect(old).toMatchObject({ kind: 'answered', result: { ok: true, kind: 'note_pr', prNote: { status: 'refused', reason: expect.stringContaining('changed since you read it') } } });
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      app.stop();
    }
  });

  it('withdraws a request the app never took, and tells a taken one apart', async () => {
    const dir = folder();
    const outbox = new FileAgentRequests({ folder: dir, appRunning: () => true, waitMs: 50, pollMs: 10 });
    expect(await outbox.ask(REFRESH, 'claude-code')).toEqual({ kind: 'timeout', taken: false });
    expect(readdirSync(dir)).toEqual([]);

    // An "app" that claims the request and never answers.
    const claimer = setInterval(() => {
      for (const name of readdirSync(dir).filter((entry) => /^[0-9a-f-]{36}\.json$/.test(entry))) {
        renameSync(join(dir, name), join(dir, name.replace('.json', '.working')));
      }
    }, 5);
    try {
      expect(await outbox.ask(REFRESH, 'claude-code')).toEqual({ kind: 'timeout', taken: true });
    } finally {
      clearInterval(claimer);
    }
  });
});

describe('InMemoryAgentRequests', () => {
  it('answers from the sample-data engine directly', async () => {
    const outcome = await new InMemoryAgentRequests(new FakeEngine()).ask(
      { kind: 'propose_topic_change', payload: { topicId: 'topic-depot', kind: 'rename', prKeys: [], name: 'Depot runners', intoTopicId: null, reason: 'clearer', dryRun: true } },
      'claude-code',
    );
    expect(outcome).toMatchObject({ kind: 'answered', result: { ok: true, kind: 'propose_topic_change', topicChange: { status: 'dry_run' } } });
  });
});
