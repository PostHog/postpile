import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRequest, AgentRequestResult } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { AgentRequestInbox } from './inbox.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function folder(): string {
  return join(mkdtempSync(join(tmpdir(), 'postpile-inbox-')), 'agent-requests');
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'refresh',
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    client: 'claude-code',
    payload: { kind: 'pr', prKey: 'acme/app#1902' },
    ...overrides,
  };
}

function inbox(dir: string, handled: AgentRequest[] = [], handle?: (request: AgentRequest) => Promise<AgentRequestResult>) {
  return new AgentRequestInbox({
    folder: dir,
    now: () => NOW,
    log: () => {},
    watch: false,
    rescanMs: 0,
    handle:
      handle ??
      (async (req) => {
        handled.push(req);
        return { v: 1, ok: false, error: 'handled' };
      }),
  });
}

function result(dir: string, id = ID): AgentRequestResult | null {
  const path = join(dir, `${id}.result.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as AgentRequestResult) : null;
}

describe('AgentRequestInbox', () => {
  it('creates its folder 0700, answers a request and cleans up after itself', async () => {
    const dir = folder();
    const handled: AgentRequest[] = [];
    const box = inbox(dir, handled);
    box.start();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    writeFileSync(join(dir, `${ID}.json`), JSON.stringify(request()));

    await box.scan();

    expect(handled.map((req) => [req.kind, req.client, req.payload])).toEqual([['refresh', 'claude-code', { kind: 'pr', prKey: 'acme/app#1902' }]]);
    expect(result(dir)).toEqual({ v: 1, ok: false, error: 'handled' });
    expect(readdirSync(dir).sort()).toEqual([`${ID}.result.json`]);
  });

  it('answers unknown versions, kinds and bad payloads with why, without handling them', async () => {
    const dir = folder();
    const handled: AgentRequest[] = [];
    const box = inbox(dir, handled);
    box.start();
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    writeFileSync(join(dir, `${ids[0]}.json`), JSON.stringify(request({ v: 2 })));
    writeFileSync(join(dir, `${ids[1]}.json`), JSON.stringify(request({ kind: 'approve' })));
    writeFileSync(join(dir, `${ids[2]}.json`), JSON.stringify(request({ payload: { kind: 'pr', prKey: '; rm -rf /' } })));
    writeFileSync(join(dir, `${ids[3]}.json`), 'not json');

    await box.scan();

    expect(handled).toEqual([]);
    expect(result(dir, ids[0])).toMatchObject({ ok: false, error: expect.stringContaining('unknown request version 2') });
    expect(result(dir, ids[1])).toMatchObject({ ok: false, error: 'unknown request kind approve' });
    expect(result(dir, ids[2])).toMatchObject({ ok: false, error: 'bad refresh payload' });
    expect(result(dir, ids[3])).toMatchObject({ ok: false, error: 'not JSON' });
  });

  it('drops expired requests unanswered, and symlinks untouched', async () => {
    const dir = folder();
    const handled: AgentRequest[] = [];
    const box = inbox(dir, handled);
    box.start();
    writeFileSync(join(dir, `${ID}.json`), JSON.stringify(request({ expiresAt: new Date(NOW.getTime() - 1).toISOString() })));
    const target = join(dir, '..', 'elsewhere.json');
    writeFileSync(target, JSON.stringify(request()));
    const linkId = '55555555-5555-4555-8555-555555555555';
    symlinkSync(target, join(dir, `${linkId}.json`));

    await box.scan();

    expect(handled).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(target)).toBe(true);
  });

  it('refuses a request bigger than 16 KB', async () => {
    const dir = folder();
    const handled: AgentRequest[] = [];
    const box = inbox(dir, handled);
    box.start();
    writeFileSync(join(dir, `${ID}.json`), JSON.stringify(request({ client: 'x'.repeat(20_000) })));
    await box.scan();
    expect(handled).toEqual([]);
    expect(result(dir)).toMatchObject({ ok: false, error: expect.stringContaining('request too large') });
  });

  it('answers with the error when handling throws', async () => {
    const dir = folder();
    const box = inbox(dir, [], async () => {
      throw new Error('database is locked');
    });
    box.start();
    writeFileSync(join(dir, `${ID}.json`), JSON.stringify(request()));
    await box.scan();
    expect(result(dir)).toEqual({ v: 1, ok: false, error: 'PostPile failed: database is locked' });
  });

  it('sweeps claims from a previous run and results older than an hour at start', async () => {
    const dir = folder();
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    writeFileSync(join(dir, `${ID}.working`), '{}');
    const old = '66666666-6666-4666-8666-666666666666';
    writeFileSync(join(dir, `${old}.result.json`), '{}');
    const hourAgo = new Date(NOW.getTime() - 3600_001);
    utimesSync(join(dir, `${old}.result.json`), hourAgo, hourAgo);
    const recent = '77777777-7777-4777-8777-777777777777';
    writeFileSync(join(dir, `${recent}.result.json`), '{}');

    inbox(dir).start();

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual([`${recent}.result.json`]);
  });
});
