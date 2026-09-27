import type {
  ActionResult,
  ChatMessage,
  ChatReply,
  FeedbackInput,
  PrDetail,
  PrKey,
  SnoozeCondition,
  SyncReport,
  TopicDetail,
  TopicListItem,
} from '@code-manager/core';

// The desktop preload provides the API location and token. As a plain web page
// (later) the query string or the default dev server is used instead.
const params = new URLSearchParams(window.location.search);
const baseUrl = window.codeManager?.apiUrl || params.get('api') || 'http://127.0.0.1:4870';
const token = window.codeManager?.token || params.get('token') || '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

function prPath(prKey: PrKey): string {
  const [repo = '', number = ''] = prKey.split('#');
  return `/api/prs/${repo}/${number}`;
}

function tilePath(tileId: string): string {
  return `/api/tiles/${encodeURIComponent(tileId)}`;
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

export function getPr(prKey: PrKey): Promise<PrDetail> {
  return request('GET', prPath(prKey));
}

export function approve(prKey: PrKey): Promise<ActionResult> {
  return request('POST', `${prPath(prKey)}/approve`);
}

export function draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
  return request('POST', `${prPath(prKey)}/draft-ask`, { person, intent });
}

export function sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
  return request('POST', `${prPath(prKey)}/comment`, { body });
}

export function markRead(tileId: string): Promise<ActionResult> {
  return request('POST', `${tilePath(tileId)}/mark-read`);
}

export function snooze(tileId: string, condition: SnoozeCondition): Promise<ActionResult> {
  return request('POST', `${tilePath(tileId)}/snooze`, { condition });
}

export function unsnooze(tileId: string): Promise<ActionResult> {
  return request('DELETE', `${tilePath(tileId)}/snooze`);
}

export function getChat(tileId: string): Promise<ChatMessage[]> {
  return request('GET', `${tilePath(tileId)}/chat`);
}

export function chat(tileId: string, message: string): Promise<ChatReply> {
  return request('POST', `${tilePath(tileId)}/chat`, { message });
}

export function undo(undoToken: string | null): Promise<ActionResult> {
  return request('POST', '/api/undo', { undoToken });
}

export function giveFeedback(input: FeedbackInput): Promise<ActionResult> {
  return request('POST', '/api/feedback', input);
}

export function unmuteEvent(eventId: string): Promise<ActionResult> {
  return request('POST', `/api/events/${encodeURIComponent(eventId)}/unmute`);
}

export function decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
  return request('POST', `/api/topics/${encodeURIComponent(topicId)}/tailoring`, { text, keep });
}

export function decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
  return request('POST', `/api/proposals/${encodeURIComponent(proposalId)}`, { accept });
}
