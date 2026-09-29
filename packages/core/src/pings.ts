// Mac pings: which new activity may interrupt the user, and what the
// notification says when the agent does not write it. Rules only, no IO.
// DESIGN.md "Live poll and Mac pings" has the whole flow.
import { isAutomation } from './bots.ts';
import { CHANGES_ANSWERED_REASON, isChangesAnswerEvent } from './changes-answered.ts';
import { clipText } from './dossier.ts';
import type { GitHubQuotaView } from './github-quota.ts';
import { ADDRESSED_KINDS, PERSONAL_ASK_KINDS } from './kinds.ts';
import { isRoutedTeamRequestEvent } from './glance-pings.ts';
import { effectiveLoudness } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import { reviewRequestTarget, teamSlug } from './review-request.ts';
import type { Glance, IsoTime, Loudness, Pr, PrEvent, PrKey, Viewer } from './types.ts';

/**
 * What the rules make of a PR's new events, most aimed at the user first.
 * Only `addressed` can ping here: the agent sees those and may veto or
 * rephrase. `routed` is a review request routed to the viewer's team on a
 * PR from outside the team: it never pings from the poll, it pings once when
 * the glance says Look closer (`lookCloserPingCheck`, 2026-09-29).
 */
export type PingRuleClass = 'addressed' | 'routed' | 'not_addressed' | 'quiet' | 'muted' | 'bot' | 'quiet_repo';

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
}

/** What the desktop shows: one ping, or a summary of a burst (count > 1). */
export interface MacNotification {
  title: string;
  body: string;
  /** For a summary, the first ping's target. */
  target: PingTarget | null;
  count: number;
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
      return sameLogin(pr.author, viewer.login);
    default:
      return false;
  }
}

function ruleFrom(pingClass: PingRuleClass, event: PrEvent): PingRule {
  const reason = event.override?.reason ?? event.ruleReason;
  return { class: pingClass, loudness: effectiveLoudness(event), reason, event };
}

/**
 * The deterministic part of a ping decision for one PR's new events.
 * Newest event first within a class, so the notification is about the
 * latest thing that happened. A PR in a quiet repo ("Let it go stale")
 * never pings, whatever happened.
 */
export function pingRule(events: PrEvent[], pr: Pr, viewer: Viewer, quietRepo: boolean): PingRule {
  if (events.length === 0) {
    return { class: 'quiet', loudness: 'quiet', reason: 'no new events', event: null };
  }
  const newestFirst = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  if (quietRepo) {
    return { ...ruleFrom('quiet_repo', newestFirst[0]!), reason: 'quiet repo (let it go stale)' };
  }
  // Bot-only: a review request aimed at the viewer or their team is no bot's, whoever clicked it (`isAutomation`).
  if (newestFirst.every((event) => isAutomation(event, reviewRequestTarget(event, pr), viewer))) {
    return ruleFrom('bot', newestFirst[0]!);
  }
  const aimed = newestFirst.filter((event) => isAddressedToViewer(event, pr, viewer));
  const addressed = aimed.find((event) => !isRoutedTeamRequestEvent(event, pr, viewer));
  if (addressed) {
    return ruleFrom('addressed', addressed);
  }
  const routed = aimed[0];
  if (routed) {
    return { ...ruleFrom('routed', routed), reason: 'review routed to your team: pings when the glance says Look closer' };
  }
  const loud = newestFirst.find((event) => effectiveLoudness(event) === 'loud');
  if (loud) {
    return ruleFrom('not_addressed', loud);
  }
  const quiet = newestFirst.find((event) => effectiveLoudness(event) === 'quiet');
  if (quiet) {
    return ruleFrom('quiet', quiet);
  }
  return ruleFrom('muted', newestFirst[0]!);
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
