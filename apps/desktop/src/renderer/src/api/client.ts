import type { PrKey } from '@postpile/core';

// The desktop preload provides the API location and token. As a plain web page
// (later) the query string or the default dev server is used instead.
const params = new URLSearchParams(window.location.search);
const baseUrl = window.postpile?.apiUrl || params.get('api') || 'http://127.0.0.1:4870';
const token = window.postpile?.token || params.get('token') || '';

/** A non-2xx answer from the API. `status` lets callers tell "not found" from a server error. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** One JSON request against the local API. Non-2xx answers throw with the server's error text. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-postpile-token': token };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const message = (json as { error?: string }).error ?? response.statusText;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

/** "owner/repo#12" -> "/api/prs/owner/repo/12". */
export function prPath(prKey: PrKey): string {
  const [repo = '', number = ''] = prKey.split('#');
  return `/api/prs/${repo}/${number}`;
}

/** Tile ids contain "/", "#" and ":", so they are encoded. */
export function tilePath(tileId: string): string {
  return `/api/tiles/${encodeURIComponent(tileId)}`;
}

/** One PR of a tile: "/api/tiles/<encoded tile id>/prs/owner/repo/12". */
export function tilePrPath(tileId: string, prKey: PrKey): string {
  const [repo = '', number = ''] = prKey.split('#');
  return `${tilePath(tileId)}/prs/${repo}/${number}`;
}
