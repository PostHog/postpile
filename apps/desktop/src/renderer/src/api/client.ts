import type { PrKey } from '@postpile/core';

// The desktop preload provides the API location and token. A page served by
// the API itself carries the token in a meta tag and calls its own origin.
// Otherwise (the Vite dev server, a static host) the query string or the
// default server is used.
const params = new URLSearchParams(window.location.search);
const servedToken = document.querySelector<HTMLMetaElement>('meta[name="postpile-token"]')?.content ?? '';
const baseUrl = window.postpile?.apiUrl || params.get('api') || (servedToken ? '' : 'http://127.0.0.1:4870');
const token = window.postpile?.token || params.get('token') || servedToken;

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

/** One PR of a tile: "/api/tiles/<encoded tile id>/prs/owner/repo/12". */
export function tilePrPath(tileId: string, prKey: PrKey): string {
  const [repo = '', number = ''] = prKey.split('#');
  return `${tilePath(tileId)}/prs/${repo}/${number}`;
}
