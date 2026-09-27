import type { PrDetail, SyncReport, TopicDetail, TopicListItem } from '@code-manager/core';

// The main process passes the API location and token in the query string, so
// the same renderer can later point at a remote server as a web app.
const params = new URLSearchParams(window.location.search);
const baseUrl = params.get('api') ?? 'http://127.0.0.1:4870';
const token = params.get('token') ?? '';

async function request<T>(method: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'x-code-manager-token': token },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: string }).error ?? response.statusText;
    throw new Error(message);
  }
  return body as T;
}

export function sync(): Promise<SyncReport> {
  return request('POST', '/api/sync');
}

export function listTopics(): Promise<TopicListItem[]> {
  return request('GET', '/api/topics');
}

export function getTopic(topicId: string): Promise<TopicDetail> {
  return request('GET', `/api/topics/${encodeURIComponent(topicId)}`);
}

export function getPr(prKey: string): Promise<PrDetail> {
  const [repo = '', number = ''] = prKey.split('#');
  return request('GET', `/api/prs/${repo}/${number}`);
}
