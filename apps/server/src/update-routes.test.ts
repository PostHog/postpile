import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@postpile/core';
import { createApp, TOKEN_HEADER } from './app.ts';
import { FakeEngine } from './fake/fake-engine.ts';
import { FakeUpdates } from './fake/fake-update.ts';
import { RELEASES_URL, UpdateChecker } from './update-check.ts';

const TOKEN = 'secret';
const CONFIG: AppConfig = { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null };
const NOW = new Date('2026-09-29T12:00:00Z');

const RELEASES = [
  { tag_name: 'v0.1.0-alpha.2', html_url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.2', published_at: '2026-09-29T09:00:00Z', body: 'Draft', draft: true },
  { tag_name: 'v0.1.0-alpha.1', html_url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.1', published_at: '2026-09-28T09:00:00Z', body: 'Fixes', draft: false },
  { tag_name: 'v0.1.0-alpha.0', html_url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.0', published_at: '2026-09-20T09:00:00Z', body: null, draft: false },
];

interface SentRequest {
  url: string;
  headers: Record<string, string>;
}

/** Answers each call with the next response and records what was sent. */
function stubFetch(responses: (() => Response)[]): { fetch: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    const next = responses.shift();
    if (!next) {
      throw new Error('no more stubbed responses');
    }
    return next();
  };
  return { fetch: stub as typeof fetch, sent };
}

async function getUpdate(checker: UpdateChecker | FakeUpdates): Promise<unknown> {
  const app = createApp(new FakeEngine({ syncStepMs: 0 }), TOKEN, CONFIG, checker);
  const response = await app.request('/api/update', { headers: { [TOKEN_HEADER]: TOKEN } });
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/update', () => {
  it('is empty before the first check', async () => {
    const checker = new UpdateChecker({ current: '0.1.0-alpha.0', fetch: stubFetch([]).fetch, now: () => NOW });
    expect(await getUpdate(checker)).toEqual({ current: '0.1.0-alpha.0', latest: null, checkedAt: null, error: null });
  });

  it('serves the newest non-draft release after a check, and asks with the ETag next time', async () => {
    const stub = stubFetch([
      () => Response.json(RELEASES, { headers: { etag: '"abc"' } }),
      () => new Response(null, { status: 304 }),
    ]);
    const checker = new UpdateChecker({ current: '0.1.0-alpha.0', fetch: stub.fetch, now: () => NOW });
    await checker.check();
    const expected = {
      current: '0.1.0-alpha.0',
      latest: { version: '0.1.0-alpha.1', url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.1', publishedAt: '2026-09-28T09:00:00Z', notes: 'Fixes' },
      checkedAt: NOW.toISOString(),
      error: null,
    };
    expect(await getUpdate(checker)).toEqual(expected);

    await checker.check();
    expect(await getUpdate(checker)).toEqual(expected);
    expect(stub.sent.map((request) => request.url)).toEqual([RELEASES_URL, RELEASES_URL]);
    expect(stub.sent[0]?.headers).toMatchObject({ Accept: 'application/vnd.github+json', 'User-Agent': expect.stringContaining('PostPile/0.1.0-alpha.0') });
    expect(stub.sent[0]?.headers['If-None-Match']).toBeUndefined();
    expect(stub.sent[1]?.headers['If-None-Match']).toBe('"abc"');
  });

  it('keeps the last known update and reports the error when a check fails', async () => {
    const logs: string[] = [];
    const stub = stubFetch([
      () => Response.json(RELEASES),
      () => new Response('rate limited', { status: 403 }),
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const checker = new UpdateChecker({ current: '0.1.0-alpha.0', fetch: stub.fetch, now: () => NOW, log: (line) => logs.push(line) });
    await checker.check();
    await checker.check();
    expect(await getUpdate(checker)).toMatchObject({ latest: { version: '0.1.0-alpha.1' }, error: 'GitHub answered 403' });
    await checker.check();
    expect(await getUpdate(checker)).toMatchObject({ latest: { version: '0.1.0-alpha.1' }, error: 'fetch failed' });
    expect(logs).toEqual(['update check failed: GitHub answered 403', 'update check failed: fetch failed']);
  });

  it('shows nothing when the app is up to date', async () => {
    const checker = new UpdateChecker({ current: '0.1.0-alpha.1', fetch: stubFetch([() => Response.json(RELEASES)]).fetch, now: () => NOW });
    await checker.check();
    expect(await getUpdate(checker)).toMatchObject({ latest: null, error: null });
  });

  it('serves a sample update in fake mode, or none with POSTPILE_FAKE_UPDATE=0', async () => {
    expect(await getUpdate(new FakeUpdates('0.1.0-alpha.0', true))).toMatchObject({ latest: { version: '0.1.0-alpha.1' } });
    expect(await getUpdate(new FakeUpdates('0.1.0-alpha.0', false))).toMatchObject({ latest: null });
  });
});
