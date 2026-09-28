// The detail pane's activity list: the meaningful events of a PR, with push
// bursts collapsed and bot / CI noise folded into one line. Rules only; the
// engine and FakeEngine ship the result on `PrDetail.activity`.
import { reviewRequestSubject } from './events.ts';
import { PUSH_KINDS } from './kinds.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { EventDisplayState, EventKind, IsoTime, Viewer } from './types.ts';
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
  /** When the newest event of the line happened. */
  at: IsoTime;
  /** The loudest state among its events (loud wins, then the newest event's). */
  display: EventDisplayState;
  /** New since you looked: an unseen loud event is in it. */
  isNew: boolean;
  /** Newest first. */
  events: EventView[];
}

export interface ActivityList {
  /** New since you looked, newest first. */
  fresh: ActivityLine[];
  /** Everything else that matters, newest first. */
  earlier: ActivityLine[];
  /** Bot and CI events, agent-muted ones and review requests between others, newest first. */
  noise: EventView[];
  /** The folded noise line: "4 bot/CI events". */
  noiseLabel: string;
  /** Lines to show before "Show all N" (ACTIVITY_LINE_CAP). */
  cap: number;
}

const HUMAN_TALK: EventKind[] = [
  'comment',
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

function toLine(group: EventView[]): ActivityLine {
  const newestFirst = group.toReversed();
  const newest = newestFirst[0]!;
  const loud = group.some((view) => view.display === 'loud');
  const summary = group.length > 1 ? burstSummary(newest.event.actor, group) : newest.event.summary;
  return {
    id: newest.event.id,
    kind: newest.event.kind,
    actor: newest.event.actor,
    summary,
    at: newest.event.at,
    display: loud ? 'loud' : newest.display,
    isNew: loud,
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

/**
 * The activity list for one PR. Meaningful events: human comments and
 * reviews, mentions, review requests naming you or your team, human pushes
 * (a burst by one person is one line), and lifecycle (ready, draft, merged,
 * closed, reopened). The rest (bots, CI, deploys, merge queue, agent-muted
 * events, review requests between others) goes to `noise`.
 */
export function activityList(events: EventView[], viewer: Viewer | null): ActivityList {
  const sorted = events.toSorted(byTime);
  const meaningful = sorted.filter((view) => isMeaningful(view, viewer));
  const noise = sorted.filter((view) => !isMeaningful(view, viewer)).toReversed();
  const lines = groupBursts(meaningful).map(toLine).toReversed();
  return {
    fresh: lines.filter((line) => line.isNew),
    earlier: lines.filter((line) => !line.isNew),
    noise,
    noiseLabel: noiseLabel(noise),
    cap: ACTIVITY_LINE_CAP,
  };
}
