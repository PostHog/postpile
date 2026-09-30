// Mac pings: which new activity may interrupt the user, and what the
// notification says when the agent does not write it. Rules only, no IO.
// DESIGN.md "Live poll and Mac pings" has the whole flow.
import { isAutomation } from './bots.ts';
import { CHANGES_ANSWERED_REASON, isChangesAnswerEvent } from './changes-answered.ts';
import { clipText } from './dossier.ts';
import type { GitHubQuotaView } from './github-quota.ts';
import { ADDRESSED_KINDS, PERSONAL_ASK_KINDS } from './kinds.ts';
import { isRoutedTeamRequestEvent } from './glance-pings.ts';
import { effectiveLoudness, raisedToLoud } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { reviewRequestTarget, teamSlug } from './review-request.ts';
import type { Glance, IsoTime, Loudness, Pr, PrEvent, PrKey, Viewer } from './types.ts';

/**
 * What the rules make of a PR's new events, most aimed at the user first.
 * Only `addressed` can ping here: the agent sees those and may veto or
 * rephrase. `routed` is a review request routed to the viewer's team on a
 * PR from outside the team: it never pings from the poll, it pings once when
 * the glance says Look closer (`lookCloserPingCheck`, 2026-09-29).
 * `snoozed`: the tile holding the PR stays snoozed after the new events, so
 * nothing woke it and nothing pings.
 */
export type PingRuleClass = 'addressed' | 'routed' | 'not_addressed' | 'quiet' | 'muted' | 'bot' | 'quiet_repo' | 'snoozed';

export interface PingRule {
  class: PingRuleClass;
  loudness: Loudness;
  reason: string;
  /** The event the class comes from. Null when there were no events. */
  event: PrEvent | null;
}

/** Where a click on a ping goes. tileId null: the topic is enough, the renderer picks a tile. */
export interface PingTarget {
  topicId: string | null;
  tileId: string | null;
  prKey: PrKey;
}

/** glance: a routed team request whose glance said Look closer (`lookCloserPingCheck`). */
export type PingDecisionSource = 'rules' | 'agent' | 'fallback' | 'glance';

/** One decision per PR thread with new activity in a poll cycle. Stored in ping_decision for debugging. */
export interface PingDecision {
  threadId: string;
  prKey: PrKey;
  ping: boolean;
  title: string;
  body: string;
  reason: string;
  source: PingDecisionSource;
  at: IsoTime;
}

/** A decision that said ping, with where a click should go. */
export interface Ping {
  title: string;
  body: string;
  target: PingTarget;
  /** Aimed at the viewer in person (`isPersonalPing`): the Dock bounces for it. */
  personal: boolean;
}

/** What the desktop shows: one ping, or a summary of a burst (count > 1). */
export interface MacNotification {
  title: string;
  body: string;
  /** For a summary, the first ping's target. */
  target: PingTarget | null;
  count: number;
  /** At least one of its pings is personal. */
  personal: boolean;
}

export type LivePollState = 'off' | 'waiting' | 'polling' | 'blocked' | 'backoff';

/** The fast notification poll, as the status footer shows it. */
export interface LivePollStatus {
  state: LivePollState;
  /** The configured interval: POSTPILE_POLL_SECONDS, default 60. */
  intervalSeconds: number;
  /** The last X-Poll-Interval GitHub sent; null until it sent one. */
  githubPollIntervalSeconds: number | null;
  /**
   * How often the poll runs while the GitHub quota is fine: intervalSeconds,
   * raised to githubPollIntervalSeconds (DESIGN.md "Live poll and Mac pings").
   * A low quota slows it further (githubQuota.pollSeconds).
   */
  everySeconds: number;
  lastPollAt: IsoTime | null;
  /** Last cycle whose inbox answer was not a 304. */
  lastChangeAt: IsoTime | null;
  nextPollAt: IsoTime | null;
  /** Set while backing off after a rate limit or an error. */
  backoffUntil: IsoTime | null;
  /** "rate limited (403), retry after 90s", "error: ...", "full sync running". Null when polling normally. */
  note: string | null;
  /** Grows with every cycle that stored something; the renderer refetches when it moves. */
  changeCount: number;
  /** Pings shown on the Mac since the app started (a summary counts once). */
  notificationsShown: number;
  /** A full sync runs, started by anyone (Sync now, the start sync, the hourly auto sync). */
  syncRunning: boolean;
  /** When the next background full sync is due; null while auto sync is off or not started. */
  nextAutoSyncAt: IsoTime | null;
  /** Grows when a glance catch-up run is queued, starts or ends; the renderer refetches when it moves. */
  catchUpChanges: number;
  /** Set while the GitHub quota is low or critical and background work waits (DESIGN.md "GitHub quota"); null when ok. */
  githubQuota: GitHubQuotaView | null;
  /** The newest clicked mark-read that stayed unread after its refresh, for the toast; null before the first. */
  keptUnread: KeptUnreadNotice | null;
}

/**
 * A Mark read GitHub skipped for newer activity that stayed unread after
 * the PR was fetched again: "New since you looked: a review from alice".
 * `id` grows, so the renderer shows each one once.
 */
export interface KeptUnreadNotice {
  id: number;
  message: string;
  prKey: PrKey;
}

/** Before the poll starts, and for hosts that never start it (CLI, standalone server). */
export const OFF_POLL_STATUS: LivePollStatus = {
  state: 'off',
  intervalSeconds: 0,
  githubPollIntervalSeconds: null,
  everySeconds: 0,
  lastPollAt: null,
  lastChangeAt: null,
  nextPollAt: null,
  backoffUntil: null,
  note: null,
  changeCount: 0,
  notificationsShown: 0,
  syncRunning: false,
  nextAutoSyncAt: null,
  catchUpChanges: 0,
  githubQuota: null,
  keptUnread: null,
};

/**
 * Loud events that are about the user in person: someone talks to them,
 * or, on an open PR, asks for their review, blocks their own PR, addresses
 * their changes request (the author pushed or replied after it), or pushes
 * after their approval when the agent raised that push (it starts quiet).
 * Other loud events (a comment or an approval on their PR, a merge without
 * their review) stay unread tiles but never ping.
 */
export function isAddressedToViewer(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (effectiveLoudness(event) !== 'loud') {
    return false;
  }
  // Nobody reviews a draft right away: only a personal question or mention pings.
  if (pr.isDraft && pr.state === 'OPEN') {
    return PERSONAL_ASK_KINDS.includes(event.kind);
  }
  if (ADDRESSED_KINDS.includes(event.kind)) {
    return true;
  }
  // A review request or a push on a merged or closed PR leaves nothing to do.
  if (pr.state !== 'OPEN') {
    return false;
  }
  if (isChangesAnswerEvent(event, pr, viewer)) {
    return true;
  }
  switch (event.kind) {
    case 'review_requested':
    case 'commits_after_approval':
      return true;
    case 'review_changes_requested':
      return isPrOwner(pr, viewer.login);
    default:
      return false;
  }
}

/**
 * A ping about the viewer in person: a mention, question or reply to them, or
 * a review request that names them and not a team, or the author's answer to
 * their changes request. A team mention, a team request and other push or
 * changes-request events are not (they may still ping).
 */
export function isPersonalPing(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (PERSONAL_ASK_KINDS.includes(event.kind) || isChangesAnswerEvent(event, pr, viewer)) {
    return true;
  }
  if (event.kind !== 'review_requested') {
    return false;
  }
  const subject = reviewRequestTarget(event, pr);
  return subject !== null && sameLogin(subject, viewer.login);
}

function ruleFrom(pingClass: PingRuleClass, event: PrEvent): PingRule {
  const reason = event.override?.reason ?? event.ruleReason;
  return { class: pingClass, loudness: effectiveLoudness(event), reason, event };
}

/**
 * What the table rows look at: the events newest first, and for each class
 * the newest event that qualifies for it (undefined when none does).
 */
export interface PingContext {
  newestFirst: PrEvent[];
  quietRepo: boolean;
  /** The tile holding the PR is still snoozed with the new events in. */
  snoozed: boolean;
  /** Every event is automation at its rule's loudness: an override to loud counts as a person's news. */
  botOnly: boolean;
  addressed: PrEvent | undefined;
  routed: PrEvent | undefined;
  loud: PrEvent | undefined;
  quiet: PrEvent | undefined;
}

function buildPingContext(events: PrEvent[], pr: Pr, viewer: Viewer, quietRepo: boolean, snoozed: boolean): PingContext {
  const newestFirst = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  // Bot-only: a review request aimed at the viewer or their team is no bot's, whoever clicked it (`isAutomation`).
  // Automation the agent or the user raised to loud pings like a person's loud event (decided 2026-09-30).
  const botOnly = newestFirst.every((event) => isAutomation(event, reviewRequestTarget(event, pr), viewer) && !raisedToLoud(event));
  const aimed = newestFirst.filter((event) => isAddressedToViewer(event, pr, viewer));
  return {
    newestFirst,
    quietRepo,
    snoozed,
    botOnly,
    addressed: aimed.find((event) => !isRoutedTeamRequestEvent(event, pr, viewer)),
    routed: aimed[0],
    loud: newestFirst.find((event) => effectiveLoudness(event) === 'loud'),
    quiet: newestFirst.find((event) => effectiveLoudness(event) === 'quiet'),
  };
}

/** One row of the ping table: a named condition, the class it decides, and which event it is about. */
export interface PingRow {
  name: string;
  when: (context: PingContext) => boolean;
  class: PingRuleClass;
  /** The event the class comes from. Null when there were no events. */
  event: (context: PingContext) => PrEvent | null;
  /** Replaces the event's own reason. */
  reason?: string;
}

function newestEvent(context: PingContext): PrEvent {
  return context.newestFirst[0]!;
}

/**
 * The ping classes as a table. Read top to bottom, first match wins. Within
 * a class the event is the newest one that qualifies, so the notification is
 * about the latest thing that happened. The last row matches everything.
 */
export const PING_TABLE: readonly PingRow[] = [
  {
    name: 'no new events',
    when: (context) => context.newestFirst.length === 0,
    class: 'quiet',
    event: () => null,
    reason: 'no new events',
  },
  {
    // A PR in a quiet repo ("Let it go stale") never pings, whatever happened.
    name: 'quiet repo',
    when: (context) => context.quietRepo,
    class: 'quiet_repo',
    event: newestEvent,
    reason: 'quiet repo (let it go stale)',
  },
  {
    // A tile that is still snoozed with the new events in never pings. Human
    // news and automation the agent raised to loud wake the snooze first
    // (`breaksSnooze`), so whatever is left behind a snooze stays quiet.
    name: 'snoozed tile',
    when: (context) => context.snoozed,
    class: 'snoozed',
    event: newestEvent,
    reason: 'tile snoozed',
  },
  {
    name: 'only automation',
    when: (context) => context.botOnly,
    class: 'bot',
    event: newestEvent,
  },
  {
    name: 'aimed at you',
    when: (context) => context.addressed !== undefined,
    class: 'addressed',
    event: (context) => context.addressed!,
  },
  {
    name: 'routed to your team',
    when: (context) => context.routed !== undefined,
    class: 'routed',
    event: (context) => context.routed!,
    reason: 'review routed to your team: pings when the glance says Look closer',
  },
  {
    name: 'loud, not aimed at you',
    when: (context) => context.loud !== undefined,
    class: 'not_addressed',
    event: (context) => context.loud!,
  },
  {
    name: 'quiet',
    when: (context) => context.quiet !== undefined,
    class: 'quiet',
    event: (context) => context.quiet!,
  },
  {
    name: 'muted',
    when: () => true,
    class: 'muted',
    event: newestEvent,
  },
];

/** The first row that matches, or undefined when the table has a gap. */
export function findPingRow(context: PingContext): PingRow | undefined {
  return PING_TABLE.find((row) => row.when(context));
}

/**
 * The deterministic part of a ping decision for one PR's new events.
 * Newest event first within a class, so the notification is about the
 * latest thing that happened. `snoozed`: the tile holding the PR is still
 * snoozed with the new events in.
 */
export function pingRule(events: PrEvent[], pr: Pr, viewer: Viewer, quietRepo: boolean, snoozed = false): PingRule {
  const context = buildPingContext(events, pr, viewer, quietRepo, snoozed);
  const row = findPingRow(context);
  if (!row) {
    throw new Error('ping table has no row');
  }
  const event = row.event(context);
  if (event === null) {
    return { class: row.class, loudness: 'quiet', reason: row.reason ?? '', event: null };
  }
  const rule = ruleFrom(row.class, event);
  return row.reason === undefined ? rule : { ...rule, reason: row.reason };
}

/** Notification limits: macOS cuts long text anyway. */
export const PING_TITLE_MAX = 80;
export const PING_BODY_MAX = 200;

/** "Review requested for team-devex", or "Review requested from you" for a personal request. */
function requestHeadline(event: PrEvent, pr: Pr): string {
  const subject = reviewRequestTarget(event, pr);
  if (subject === null || !subject.includes('/')) {
    return 'Review requested from you';
  }
  return `Review requested for ${subject.split('/').pop()}`;
}

function headline(event: PrEvent, pr: Pr): string {
  const who = `@${event.actor}`;
  // Replies keep their own reason ("replies to you"); only pushes and plain comments carry this one.
  if (event.ruleReason === CHANGES_ANSWERED_REASON) {
    return `${who} addressed your changes`;
  }
  switch (event.kind) {
    case 'mention':
      return `${who} mentioned you`;
    case 'team_mention':
      return `${who} mentioned your team`;
    case 'question_to_user':
      return `${who} asked you something`;
    case 'reply_to_user':
      return `${who} replied to you`;
    case 'review_requested':
      // A bot's request says what it asks, not which bot clicked it.
      return event.isBot ? requestHeadline(event, pr) : `${who} asked for your review`;
    case 'commits_after_approval':
      return 'New commits after your approval';
    case 'review_changes_requested':
      return `${who} requested changes`;
    default:
      return `${who}: ${event.kind.replaceAll('_', ' ')}`;
  }
}

/** "acme/app#1850" -> "app#1850". */
function shortKey(prKey: PrKey): string {
  const slash = prKey.indexOf('/');
  return slash >= 0 ? prKey.slice(slash + 1) : prKey;
}

/** The text a ping gets when the agent does not write it (fallback, fake mode). */
export function pingTemplate(event: PrEvent, pr: Pr): { title: string; body: string } {
  return {
    title: clipText(`${headline(event, pr)} · ${shortKey(pr.key)}`, PING_TITLE_MAX),
    body: clipText(`${pr.title}\n${event.summary}`, PING_BODY_MAX),
  };
}

/** The first sentence of the glance's for-you line. */
function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return match ? match[1]! : text.trim();
}

/** "Look closer: review for team-devex · app#1850", then the PR title and the glance's first sentence. */
export function lookCloserPingText(pr: Pr, team: string, glance: Pick<Glance, 'forYou'>): { title: string; body: string } {
  return {
    title: clipText(`Look closer: review for ${teamSlug(team)} · ${shortKey(pr.key)}`, PING_TITLE_MAX),
    body: clipText(`${pr.title}\n${firstSentence(glance.forYou)}`, PING_BODY_MAX),
  };
}
