// Test helper: a fetch stand-in that records requests and replays canned responses.
import { readFileSync } from 'node:fs';
import type { FetchFn } from './http.ts';
import type { TokenSource } from './token.ts';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface CannedResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

export const fakeTokens: TokenSource = { token: async () => 'test-token' };

/** Answers requests in order. Fails the test loudly if more requests come than responses. */
export class FakeFetch {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: CannedResponse[];

  constructor(responses: CannedResponse[]) {
    this.queue = [...responses];
  }

  readonly fn: FetchFn = async (url, init) => {
    this.requests.push({
      method: init.method ?? 'GET',
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const canned = this.queue.shift();
    if (!canned) {
      throw new Error(`unexpected request: ${init.method} ${url}`);
    }
    const status = canned.status ?? 200;
    const body = status === 304 || status === 205 || canned.body === undefined ? null : JSON.stringify(canned.body);
    return new Response(body, { status, headers: canned.headers });
  };
}
