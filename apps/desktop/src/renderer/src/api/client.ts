import type { PrKey } from '@code-manager/core';

// The desktop preload provides the API location and token. As a plain web page
// (later) the query string or the default dev server is used instead.
const params = new URLSearchParams(window.location.search);
const baseUrl = window.codeManager?.apiUrl || params.get('api') || 'http://127.0.0.1:4870';
const token = window.codeManager?.token || params.get('token') || '';

/** One JSON request against the local API. Non-2xx answers throw with the server's error text. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-code-manager-token': token };
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
    throw new Error(message);
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
