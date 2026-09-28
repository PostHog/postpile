// Mac pings: which new activity may interrupt the user, and what the
// notification says when the agent does not write it. Rules only, no IO.
// DESIGN.md "Live poll and Mac pings" has the whole flow.
import { clipText } from './dossier.ts';
import { ADDRESSED_KINDS } from './kinds.ts';
import { effectiveLoudness } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import type { IsoTime, Loudness, Pr, PrEvent, PrKey, Viewer } from './types.ts';

/**
 * What the rules make of a PR's new events, most aimed at the user first.
 * Only `addressed` can ping: the agent sees those and may veto or rephrase.
 */
export type PingRuleClass = 'addressed' | 'not_addressed' | 'quiet' | 'muted' | 'bot';

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

export type PingDecisionSource = 'rules' | 'agent' | 'fallback';

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
  /** How often the app polls when nothing is wrong. POSTPILE_POLL_SECONDS, default 10. */
  intervalSeconds: number;
  /** GitHub's X-Poll-Interval from the last answer. Shown, not obeyed (see DESIGN.md). */
  githubPollIntervalSeconds: number | null;
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
}

/** Before the poll starts, and for hosts that never start it (CLI, standalone server). */
export const OFF_POLL_STATUS: LivePollStatus = {
  state: 'off',
  intervalSeconds: 0,
  githubPollIntervalSeconds: null,
  lastPollAt: null,
  lastChangeAt: null,
  nextPollAt: null,
  backoffUntil: null,
  note: null,
  changeCount: 0,
  notificationsShown: 0,
};

/**
 * Loud events that are about the user in person: someone talks to them,
 * or, on an open PR, asks for their review, pushes after their approval, or
 * blocks their own PR. Other loud events (a comment or an approval on their PR, a merge
 * without their review) stay unread tiles but never ping.
 */
export function isAddressedToViewer(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (effectiveLoudness(event) !== 'loud') {
    return false;
  }
  if (ADDRESSED_KINDS.includes(event.kind)) {
    return true;
  }
  // A review request or a push on a merged or closed PR leaves nothing to do.
  if (pr.state !== 'OPEN') {
    return false;
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
 * latest thing that happened.
 */
export function pingRule(events: PrEvent[], pr: Pr, viewer: Viewer): PingRule {
  if (events.length === 0) {
    return { class: 'quiet', loudness: 'quiet', reason: 'no new events', event: null };
  }
  const newestFirst = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  if (newestFirst.every((event) => event.isBot)) {
    return ruleFrom('bot', newestFirst[0]!);
  }
  const addressed = newestFirst.find((event) => isAddressedToViewer(event, pr, viewer));
  if (addressed) {
    return ruleFrom('addressed', addressed);
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

function headline(event: PrEvent): string {
  const who = `@${event.actor}`;
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
      return `${who} asked for your review`;
    case 'commits_after_approval':
      return 'New commits after your approval';
    case 'review_changes_requested':
      return `${who} requested changes`;
    default:
      return `${who}: ${event.kind.replaceAll('_', ' ')}`;
  }
}

/** "PostHog/posthog#41850" -> "posthog#41850". */
function shortKey(prKey: PrKey): string {
  const slash = prKey.indexOf('/');
  return slash >= 0 ? prKey.slice(slash + 1) : prKey;
}

/** The text a ping gets when the agent does not write it (fallback, fake mode). */
export function pingTemplate(event: PrEvent, pr: Pr): { title: string; body: string } {
  return {
    title: clipText(`${headline(event)} · ${shortKey(pr.key)}`, PING_TITLE_MAX),
    body: clipText(`${pr.title}\n${event.summary}`, PING_BODY_MAX),
  };
}
