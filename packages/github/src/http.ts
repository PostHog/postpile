import type { TokenSource } from './token.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const API_URL = 'https://api.github.com';

/** Calls the global fetch without binding it to our object. */
const globalFetch: FetchFn = (url, init) => fetch(url, init);

export interface RateLimitInfo {
  /** GitHub asked to slow down: 429, or 403 with a rate-limit sign (Retry-After, no requests left, "rate limit" message). */
  rateLimited: boolean;
  /** From Retry-After, or from X-RateLimit-Reset when no requests are left. Null when GitHub said neither. */
  retryAfterSeconds: number | null;
}

const NOT_LIMITED: RateLimitInfo = { rateLimited: false, retryAfterSeconds: null };

export class GitHubError extends Error {
  readonly rateLimited: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    readonly status: number,
    limit: RateLimitInfo = NOT_LIMITED,
  ) {
    super(message);
    this.name = 'GitHubError';
    this.rateLimited = limit.rateLimited;
    this.retryAfterSeconds = limit.retryAfterSeconds;
  }
}

export interface GraphQLErrorItem {
  message: string;
  path?: (string | number)[];
  type?: string;
}

/**
 * GraphQL can answer with partial data plus errors, e.g. one aliased repo the
 * token cannot see. Callers decide whether partial data is good enough.
 */
export interface GraphQLResult<T> {
  data: T | null;
  errors: GraphQLErrorItem[];
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/** Thin fetch wrapper: auth header, JSON bodies, API base URL. No retries. */
export class GitHubHttp {
  constructor(
    private readonly tokens: TokenSource,
    private readonly fetchFn: FetchFn = globalFetch,
    private readonly apiUrl: string = API_URL,
  ) {}

  /** Returns the raw response, whatever its status. Paths are relative to the API URL; full URLs pass through. */
  async request(method: string, pathOrUrl: string, options: RequestOptions = {}): Promise<Response> {
    const token = await this.tokens.token();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${this.apiUrl}/${pathOrUrl}`;
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return this.fetchFn(url, init);
  }

  /** Like request, but throws GitHubError unless the status is 2xx. */
  async requestOk(method: string, pathOrUrl: string, options: RequestOptions = {}): Promise<Response> {
    const response = await this.request(method, pathOrUrl, options);
    if (!response.ok) {
      throw await errorFromResponse(`${method} ${pathOrUrl}`, response);
    }
    return response;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResult<T>> {
    const response = await this.requestOk('POST', 'graphql', { body: { query, variables } });
    const payload = (await response.json()) as { data?: T | null; errors?: GraphQLErrorItem[] };
    return { data: payload.data ?? null, errors: payload.errors ?? [] };
  }
}

/** Whole seconds, or null for a missing or unreadable header. */
function secondsHeader(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name) ?? '');
  return response.headers.get(name) !== null && Number.isFinite(value) ? value : null;
}

/**
 * Primary limits answer 403 or 429 with X-RateLimit-Remaining 0 and a reset
 * time; secondary limits answer 403 or 429 with Retry-After or only a
 * message. `nowMs` is the local clock, compared against the reset epoch.
 */
export function rateLimitOf(response: Response, message: string, nowMs: number = Date.now()): RateLimitInfo {
  if (response.status !== 403 && response.status !== 429) {
    return NOT_LIMITED;
  }
  const retryAfter = secondsHeader(response, 'retry-after');
  const remaining = secondsHeader(response, 'x-ratelimit-remaining');
  const reset = secondsHeader(response, 'x-ratelimit-reset');
  const exhausted = remaining === 0;
  const rateLimited = response.status === 429 || retryAfter !== null || exhausted || /rate limit/i.test(message);
  if (!rateLimited) {
    return NOT_LIMITED;
  }
  if (retryAfter !== null) {
    return { rateLimited, retryAfterSeconds: Math.max(0, Math.ceil(retryAfter)) };
  }
  if (exhausted && reset !== null) {
    return { rateLimited, retryAfterSeconds: Math.max(0, Math.ceil(reset - nowMs / 1000)) };
  }
  return { rateLimited, retryAfterSeconds: null };
}

export async function errorFromResponse(what: string, response: Response): Promise<GitHubError> {
  let detail = '';
  try {
    const payload = (await response.json()) as { message?: string };
    detail = payload.message ?? '';
  } catch {
    // Body was not JSON; the status alone has to do.
  }
  const suffix = detail ? `: ${detail}` : '';
  return new GitHubError(`GitHub ${what} failed with ${response.status}${suffix}`, response.status, rateLimitOf(response, detail));
}
