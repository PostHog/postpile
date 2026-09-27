import type { NotificationReason, NotificationThread } from '@code-manager/core';
import { errorFromResponse, type GitHubHttp } from './http.ts';
import type { RawNotification } from './raw.ts';
import type { NotificationConditions, NotificationsResult } from './reader.ts';

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
    updatedAt: raw.updated_at,
    lastReadAt: raw.last_read_at,
    subjectType: raw.subject.type,
    repo: raw.repository.full_name,
    number: subjectNumber(raw),
    title: raw.subject.title,
  };
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

/**
 * Walks every page of the unread inbox. Only the first page is conditional:
 * once it comes back 200 the inbox has moved and later pages must be read in full.
 */
export async function listNotifications(
  http: GitHubHttp,
  conditions: NotificationConditions,
): Promise<NotificationsResult> {
  const first = await http.request('GET', FIRST_PAGE, { headers: conditionalHeaders(conditions) });
  if (first.status === 304) {
    return { notModified: true };
  }
  if (!first.ok) {
    throw await errorFromResponse('GET notifications', first);
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

  return {
    notModified: false,
    threads,
    etag: first.headers.get('etag'),
    lastModified: first.headers.get('last-modified'),
  };
}
