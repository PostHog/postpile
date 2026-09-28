import type { IsoTime, NotificationReason, NotificationThread } from '@postpile/core';
import { isoTime, isoTimeOrNull } from './normalize.ts';
import { errorFromResponse, type GitHubHttp } from './http.ts';
import type { RawNotification } from './raw.ts';
import type { NotificationConditions, NotificationsResult, ThreadsSinceResult } from './reader.ts';

const FIRST_PAGE = 'notifications?all=false&per_page=50';

// A safety stop for a broken Link header. 50 pages x 50 is far past any real inbox.
const MAX_PAGES = 50;

const KNOWN_REASONS: ReadonlySet<string> = new Set<NotificationReason>([
  'review_requested',
  'mention',
  'team_mention',
  'author',
  'assign',
  'comment',
  'subscribed',
  'manual',
  'state_change',
  'ci_activity',
  'approval_requested',
]);

// Only these subject URLs end in a PR/issue number. Releases end in a release id.
const NUMBERED_SUBJECTS: ReadonlySet<string> = new Set(['PullRequest', 'Issue']);

export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1] ?? null;
}

function toReason(reason: string): NotificationReason {
  return KNOWN_REASONS.has(reason) ? (reason as NotificationReason) : 'other';
}

function subjectNumber(raw: RawNotification): number | null {
  if (!raw.subject.url || !NUMBERED_SUBJECTS.has(raw.subject.type)) {
    return null;
  }
  const last = raw.subject.url.slice(raw.subject.url.lastIndexOf('/') + 1);
  const number = Number(last);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function toThread(raw: RawNotification): NotificationThread {
  return {
    id: raw.id,
    reason: toReason(raw.reason),
    unread: raw.unread,
    updatedAt: isoTime(raw.updated_at),
    lastReadAt: isoTimeOrNull(raw.last_read_at),
    subjectType: raw.subject.type,
    repo: raw.repository.full_name,
    number: subjectNumber(raw),
    title: raw.subject.title,
  };
}

/**
 * One thread, read or not. Null when GitHub no longer knows it. Used right
 * before a mark-read to check that nothing happened since the last sync.
 */
export async function getThread(http: GitHubHttp, threadId: string): Promise<NotificationThread | null> {
  const response = await http.request('GET', `notifications/threads/${encodeURIComponent(threadId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await errorFromResponse('GET notification thread', response);
  }
  return toThread((await response.json()) as RawNotification);
}

function conditionalHeaders(conditions: NotificationConditions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (conditions.etag) {
    headers['if-none-match'] = conditions.etag;
  }
  if (conditions.lastModified) {
    headers['if-modified-since'] = conditions.lastModified;
  }
  return headers;
}

/** X-Poll-Interval in seconds, or null when missing or not a positive number. */
export function pollIntervalOf(response: Response): number | null {
  const value = Number(response.headers.get('x-poll-interval') ?? '');
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The first page's answer plus every thread across pages, or null after a 304. */
interface WalkedPages {
  first: Response;
  threads: NotificationThread[] | null;
}

/**
 * Walks every page from `firstPage`. Only the first page is conditional:
 * once it comes back 200 the list has moved and later pages must be read in full.
 */
async function walkPages(http: GitHubHttp, firstPage: string, conditions: NotificationConditions, label: string): Promise<WalkedPages> {
  const first = await http.request('GET', firstPage, { headers: conditionalHeaders(conditions) });
  if (first.status === 304) {
    return { first, threads: null };
  }
  if (!first.ok) {
    throw await errorFromResponse(label, first);
  }
  const threads: NotificationThread[] = [];
  let response = first;
  for (let page = 1; ; page++) {
    const items = (await response.json()) as RawNotification[];
    threads.push(...items.map(toThread));
    const next = nextPageUrl(response.headers.get('link'));
    if (!next || page >= MAX_PAGES) {
      break;
    }
    response = await http.requestOk('GET', next);
  }
  return { first, threads };
}

/** Walks every page of the unread inbox. */
export async function listNotifications(
  http: GitHubHttp,
  conditions: NotificationConditions,
): Promise<NotificationsResult> {
  const { first, threads } = await walkPages(http, FIRST_PAGE, conditions, 'GET notifications');
  const pollIntervalSeconds = pollIntervalOf(first);
  if (threads === null) {
    return { notModified: true, pollIntervalSeconds };
  }
  return {
    notModified: false,
    threads,
    etag: first.headers.get('etag'),
    lastModified: first.headers.get('last-modified'),
    pollIntervalSeconds,
  };
}

/**
 * Read and unread threads updated since `since` (all=true), every page.
 * Finds threads read on github.com, including ones the app never saw
 * unread. The first page sends the previous ETag, which only matches while
 * `since` stays the same.
 */
export async function listThreadsSince(http: GitHubHttp, since: IsoTime, etag: string | null): Promise<ThreadsSinceResult> {
  const firstPage = `notifications?all=true&since=${encodeURIComponent(since)}&per_page=50`;
  const { first, threads } = await walkPages(http, firstPage, { etag, lastModified: null }, 'GET notifications (all)');
  if (threads === null) {
    return { notModified: true };
  }
  return { notModified: false, threads, etag: first.headers.get('etag') };
}
