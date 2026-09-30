// The detail pane's activity list: the meaningful events of a PR, with push
// bursts collapsed and bot / CI noise folded into one line. Rules only; the
// engine and FakeEngine ship the result on `PrDetail.activity`.
import { reviewRequestSubject } from './events.ts';
import { PUSH_KINDS } from './kinds.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import { effectiveLoudness } from './loudness.ts';
import type { EventDisplayState, EventKind, IsoTime, NotificationThread, Pr, Viewer } from './types.ts';
import type { EventView } from './views.ts';

/** About this many lines show before "Show all N". */
export const ACTIVITY_LINE_CAP = 12;

/** One line of the list: a single event, or a burst of pushes by one person. */
export interface ActivityLine {
  /** The newest event's id. */
  id: string;
  kind: EventKind;
  actor: string;
  summary: string;
  /**
   * The full text of a human comment or review, which `summary` clips to one
   * short line. Null for bots, pushes and everything else.
   */
  body: string | null;
  /** When the newest event of the line happened. */
  at: IsoTime;
  /** The loudest state among its events (loud wins, then the newest event's). */
  display: EventDisplayState;
  /** New since you looked: an unseen loud event is in it. */
  isNew: boolean;
  /** Any event of the line is unseen (`EventView.unseen`): the line wears the unread dot. */
  unseen: boolean;
  /** Newest first. */
  events: EventView[];
}

export interface ActivityList {
  /** New since you looked, newest first. */
  fresh: ActivityLine[];
  /** Everything else that matters, newest first. */
  earlier: ActivityLine[];
  /** Bot and CI events, agent-muted ones and review requests between others, newest first. Without `freshNoise`. */
  noise: EventView[];
  /** The folded noise line: "4 bot/CI events". */
  noiseLabel: string;
  /**
   * The unseen part of the noise since the viewer's last touch, newest first,
   * for the "New since you looked" box. Empty while nothing loud is new.
   */
  freshNoise: EventView[];
  /** The box's folded noise line: "10 bot comments, CI". */
  freshNoiseLabel: string;
  /** Lines to show before "Show all N" (ACTIVITY_LINE_CAP). */
  cap: number;
  /**
   * The tile is unread because GitHub updated the notification and no event
   * explains it (the thread reason "new activity on GitHub"): when GitHub did
   * it. The pane shows one dotted line at the top. Null otherwise.
   */
  threadChangedAt: IsoTime | null;
}

const HUMAN_TALK: EventKind[] = [
  'comment',
  'comment_edited',
  'reply_to_user',
  'question_to_user',
  'mention',
  'team_mention',
  'review_approved',
  'review_changes_requested',
  'review_commented',
];

const LIFECYCLE: EventKind[] = ['ready_for_review', 'converted_to_draft', 'merged', 'merged_without_review', 'closed', 'reopened'];

const REVIEW_REQUESTS: EventKind[] = ['review_requested', 'review_request_removed'];

/** A review request (or its removal) naming the viewer or one of their teams. */
function involvesViewer(view: EventView, viewer: Viewer | null): boolean {
  const subject = reviewRequestSubject(view.event.summary);
  if (!viewer || subject === null) {
    return false;
  }
  return sameLogin(subject, viewer.login) || isOwnTeam(subject, viewer.teams);
}

/** Human talk, review requests about you or your team, human pushes, lifecycle. */
function isMeaningful(view: EventView, viewer: Viewer | null): boolean {
  const { event } = view;
  if (view.display === 'muted') {
    return false;
  }
  if (LIFECYCLE.includes(event.kind)) {
    return true;
  }
  if (REVIEW_REQUESTS.includes(event.kind)) {
    return involvesViewer(view, viewer);
  }
  if (event.isBot) {
    return false;
  }
  return HUMAN_TALK.includes(event.kind) || PUSH_KINDS.includes(event.kind);
}

function isPush(view: EventView): boolean {
  return PUSH_KINDS.includes(view.event.kind);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "rowan pushed 3 commits", "... after your approval" when any came after it. */
function burstSummary(actor: string, events: EventView[]): string {
  const afterApproval = events.some((view) => view.event.kind === 'commits_after_approval');
  const forced = events.filter((view) => view.event.kind === 'force_pushed').length;
  const commits = events.length - forced;
  const parts = [commits > 0 ? `pushed ${plural(commits, 'commit')}` : '', forced > 0 ? `force-pushed${forced > 1 ? ` ${forced} times` : ''}` : ''];
  const text = parts.filter((part) => part !== '').join(' and ');
  return `${actor} ${text}${afterApproval ? ' after your approval' : ''}`;
}

/** Events oldest first, grouped: consecutive pushes by one person make one group. */
function groupBursts(events: EventView[]): EventView[][] {
  const groups: EventView[][] = [];
  for (const view of events) {
    const last = groups[groups.length - 1];
    const lastView = last?.[last.length - 1];
    if (last && lastView && isPush(view) && isPush(lastView) && sameLogin(lastView.event.actor, view.event.actor)) {
      last.push(view);
    } else {
      groups.push([view]);
    }
  }
  return groups;
}

/** The full body behind a human comment or review event; bots keep the one-line summary. */
function fullBody(view: EventView, pr: Pr | null): string | null {
  const { event } = view;
  if (!pr || event.isBot || !HUMAN_TALK.includes(event.kind)) {
    return null;
  }
  const comment = pr.comments.find((c) => c.id === event.sourceId);
  const review = pr.reviews.find((r) => r.id === event.sourceId);
  const body = (comment?.body ?? review?.body ?? '').trim();
  return body === '' ? null : body;
}

function toLine(group: EventView[], pr: Pr | null): ActivityLine {
  const newestFirst = group.toReversed();
  const newest = newestFirst[0]!;
  const loud = group.some((view) => view.display === 'loud');
  const summary = group.length > 1 ? burstSummary(newest.event.actor, group) : newest.event.summary;
  return {
    id: newest.event.id,
    kind: newest.event.kind,
    actor: newest.event.actor,
    summary,
    body: group.length > 1 ? null : fullBody(newest, pr),
    at: newest.event.at,
    display: loud ? 'loud' : newest.display,
    isNew: loud,
    unseen: group.some((view) => view.unseen),
    events: newestFirst,
  };
}

function byTime(a: EventView, b: EventView): number {
  return a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : 0;
}

/** "4 bot/CI events", or "4 bot/CI and other events" when review requests between others are in it. */
export function noiseLabel(noise: EventView[]): string {
  const machineKinds: EventKind[] = ['ci', 'deploy', 'merge_queue', 'bot_comment'];
  const machine = noise.every((view) => view.event.isBot || machineKinds.includes(view.event.kind));
  const events = noise.length === 1 ? 'event' : 'events';
  return machine ? `${noise.length} bot/CI ${events}` : `${noise.length} bot/CI and other ${events}`;
}

function countWord(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}

/**
 * The noise by what it is, for the "New since you looked" box: "10 bot
 * comments, CI", "2 bot pushes, a deploy, merge queue, 1 other".
 */
export function noiseSummary(noise: EventView[]): string {
  const count = (test: (view: EventView) => boolean) => noise.filter(test).length;
  const isKind = (kinds: EventKind[]) => (view: EventView) => kinds.includes(view.event.kind);
  const comments = count((view) => view.event.kind === 'bot_comment' || (view.event.isBot && HUMAN_TALK.includes(view.event.kind)));
  const pushes = count((view) => view.event.isBot && PUSH_KINDS.includes(view.event.kind));
  const ci = count(isKind(['ci']));
  const deploys = count(isKind(['deploy']));
  const queue = count(isKind(['merge_queue']));
  const other = noise.length - comments - pushes - ci - deploys - queue;
  const parts = [
    comments > 0 ? countWord(comments, 'bot comment') : '',
    pushes > 0 ? countWord(pushes, 'bot push', 'bot pushes') : '',
    ci > 0 ? 'CI' : '',
    deploys > 0 ? (deploys === 1 ? 'a deploy' : `${deploys} deploys`) : '',
    queue > 0 ? 'merge queue' : '',
    other > 0 ? `${other} other` : '',
  ];
  return parts.filter((part) => part !== '').join(', ');
}

/**
 * When GitHub changed an unread notification thread that no event explains:
 * nothing unseen and loud, and no unseen quiet event since the thread's last
 * read. Mirrors the tile's thread reason (`threadReasons` in tiles.ts), which
 * then says "new activity on GitHub".
 */
export function threadChangedAt(thread: NotificationThread | null, events: EventView[]): IsoTime | null {
  if (!thread || !thread.unread) {
    return null;
  }
  const explains = (view: EventView) => {
    const { event } = view;
    if (event.seenAt !== null) {
      return false;
    }
    const loudness = effectiveLoudness(event);
    return loudness === 'loud' || (loudness === 'quiet' && (thread.lastReadAt === null || event.at > thread.lastReadAt));
  };
  return events.some(explains) ? null : thread.updatedAt;
}

/**
 * The activity list for one PR. Meaningful events: human comments and
 * reviews, mentions, review requests naming you or your team, human pushes
 * (a burst by one person is one line), and lifecycle (ready, draft, merged,
 * closed, reopened). The rest (bots, CI, deploys, merge queue, agent-muted
 * events, review requests between others) goes to `noise`.
 *
 * While something loud is new, the unseen noise after `since` (the viewer's
 * last touch, `whatsNew().anchor.at`; null for a first look) moves to
 * `freshNoise`, so the box and the list below never show it twice.
 *
 * With `pr`, lines of human comments and reviews carry the full `body`.
 * With `thread` (the PR's notification thread), `threadChangedAt` says when an
 * unread thread changed without an event to show for it.
 */
export function activityList(
  events: EventView[],
  viewer: Viewer | null,
  since: IsoTime | null = null,
  pr: Pr | null = null,
  thread: NotificationThread | null = null,
): ActivityList {
  const sorted = events.toSorted(byTime);
  const meaningful = sorted.filter((view) => isMeaningful(view, viewer));
  const allNoise = sorted.filter((view) => !isMeaningful(view, viewer)).toReversed();
  const lines = groupBursts(meaningful).map((group) => toLine(group, pr)).toReversed();
  const fresh = lines.filter((line) => line.isNew);
  const isFreshNoise = (view: EventView) => fresh.length > 0 && view.display !== 'seen' && (since === null || view.event.at > since);
  const freshNoise = allNoise.filter(isFreshNoise);
  const noise = allNoise.filter((view) => !isFreshNoise(view));
  return {
    fresh,
    earlier: lines.filter((line) => !line.isNew),
    noise,
    noiseLabel: noiseLabel(noise),
    freshNoise,
    freshNoiseLabel: noiseSummary(freshNoise),
    cap: ACTIVITY_LINE_CAP,
    threadChangedAt: threadChangedAt(thread, events),
  };
}
