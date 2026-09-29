// "What is new" on a revisit: the viewer already touched the PR (their own
// review, approval, comment or push, or a mark-read in the app or on
// GitHub) and loud events came in after that. The tile's why-now strip and
// the detail pane's "New since you looked" box say what changed since that
// touch. Rules only; the renderer turns the result into words
// (`lib/whats-new.ts`). DESIGN.md "Tile faces" › Why now on a revisit.
import { isUnseenLoud } from './loudness.ts';
import { PUSH_KINDS } from './kinds.ts';
import { sameLogin } from './mentions.ts';
import type { EventKind, IsoTime, PrEvent, Viewer } from './types.ts';

/**
 * The viewer's last touch before the new events: one of their own actions
 * (loudness rules mark these "your own activity"), or a mark-read (events
 * turn seen when marked read in the app or when GitHub's `last_read_at`
 * passes them).
 */
export type WhatsNewAnchorKind = 'changes_request' | 'approval' | 'review' | 'comment' | 'push' | 'read';

export interface WhatsNewAnchor {
  kind: WhatsNewAnchorKind;
  at: IsoTime;
}

/**
 * What the lead line is about, most important first: a direct ask or reply,
 * a re-requested review, a verdict by someone else, pushes, anything else.
 */
export type WhatsNewLeadKind =
  | 'mention'
  | 'team_mention'
  | 'question'
  | 'reply'
  | 'review_request'
  | 'changes_requested'
  | 'approved'
  | 'push'
  | 'other';

export interface WhatsNewLead {
  kind: WhatsNewLeadKind;
  /** The event kind behind it, for the event badge. */
  eventKind: EventKind;
  actor: string;
  /** Pushes: how many push events; else 1. */
  count: number;
  /** The newest event's one-line summary, for `other` and tooltips. */
  summary: string;
}

export interface WhatsNew {
  anchor: WhatsNewAnchor;
  lead: WhatsNewLead;
  /** New loud things the lead does not cover; all pushes together count as one. */
  extraCount: number;
  /** Whose avatar the strip shows: the lead's actor. */
  actor: string;
  /** The newest new loud event, for the strip's age. */
  newestAt: IsoTime;
}

const LEAD_ORDER: WhatsNewLeadKind[] = ['mention', 'question', 'reply', 'team_mention', 'review_request', 'changes_requested', 'approved', 'push', 'other'];

function leadKindOf(kind: EventKind): WhatsNewLeadKind {
  if (PUSH_KINDS.includes(kind)) {
    return 'push';
  }
  switch (kind) {
    case 'mention':
      return 'mention';
    case 'team_mention':
      return 'team_mention';
    case 'question_to_user':
      return 'question';
    case 'reply_to_user':
    case 'comment':
    case 'review_commented':
      return 'reply';
    case 'review_requested':
      return 'review_request';
    case 'review_changes_requested':
      return 'changes_requested';
    case 'review_approved':
      return 'approved';
    default:
      return 'other';
  }
}

/** The anchor kind of one of the viewer's own events; null for kinds that are not a touch (merge, close, ...). */
function anchorKindOf(kind: EventKind): WhatsNewAnchorKind | null {
  if (PUSH_KINDS.includes(kind)) {
    return 'push';
  }
  switch (kind) {
    case 'review_changes_requested':
      return 'changes_request';
    case 'review_approved':
      return 'approval';
    case 'review_commented':
      return 'review';
    case 'comment':
    case 'reply_to_user':
    case 'question_to_user':
    case 'mention':
    case 'team_mention':
      return 'comment';
    default:
      return null;
  }
}

function isOwn(event: PrEvent, viewer: Viewer): boolean {
  return event.actor !== '' && sameLogin(event.actor, viewer.login);
}

function byTime(a: PrEvent, b: PrEvent): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

/**
 * The viewer's touch before `before`: their newest own action wins (it says
 * what they did), else the newest mark-read. Null when they never touched it.
 */
function lastTouch(events: PrEvent[], viewer: Viewer, before: IsoTime): WhatsNewAnchor | null {
  let own: WhatsNewAnchor | null = null;
  let read: IsoTime | null = null;
  for (const event of events) {
    if (isOwn(event, viewer)) {
      const kind = anchorKindOf(event.kind);
      if (kind !== null && event.at < before && (own === null || event.at >= own.at)) {
        own = { kind, at: event.at };
      }
      continue;
    }
    if (event.seenAt !== null && event.seenAt <= before && (read === null || event.seenAt > read)) {
      read = event.seenAt;
    }
  }
  if (own !== null) {
    return own;
  }
  return read === null ? null : { kind: 'read', at: read };
}

/** The most important new event (LEAD_ORDER), the newest one on a tie. Pushes count together. */
function pickLead(fresh: PrEvent[]): WhatsNewLead {
  const ranked = fresh.toSorted((a, b) => LEAD_ORDER.indexOf(leadKindOf(a.kind)) - LEAD_ORDER.indexOf(leadKindOf(b.kind)) || byTime(b, a));
  const top = ranked[0]!;
  const kind = leadKindOf(top.kind);
  const count = kind === 'push' ? fresh.filter((event) => leadKindOf(event.kind) === 'push').length : 1;
  return { kind, eventKind: top.kind, actor: top.actor, count, summary: top.summary };
}

/** New loud things besides the lead: one per event, all pushes together as one. */
function extraCount(fresh: PrEvent[], lead: WhatsNewLead): number {
  const pushes = fresh.filter((event) => leadKindOf(event.kind) === 'push').length;
  const others = fresh.length - pushes;
  if (lead.kind === 'push') {
    return others;
  }
  return others - 1 + (pushes > 0 ? 1 : 0);
}

/**
 * What changed since the viewer's last touch. New events are the unseen loud
 * ones (the same ones that make a tile unread); quiet bot and CI events never
 * count. Null when there is nothing new, or when the viewer never touched the
 * PR before the new events (a first-time ask keeps the plain wording).
 */
export function whatsNew(events: PrEvent[], viewer: Viewer | null): WhatsNew | null {
  if (viewer === null) {
    return null;
  }
  const fresh = events.filter(isUnseenLoud).toSorted(byTime);
  const first = fresh[0];
  const newest = fresh[fresh.length - 1];
  if (!first || !newest) {
    return null;
  }
  const anchor = lastTouch(events, viewer, first.at);
  if (anchor === null) {
    return null;
  }
  const lead = pickLead(fresh);
  return { anchor, lead, extraCount: extraCount(fresh, lead), actor: lead.actor, newestAt: newest.at };
}
