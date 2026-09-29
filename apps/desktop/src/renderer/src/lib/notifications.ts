import type { ActionLogEntry, ActionOrigin, NotificationDebugRow, NotificationLanding, NotificationReason, PingDecision } from '@postpile/core';
import { ageLabel } from './time.ts';

export interface NotificationFilter {
  /** Null shows every reason. */
  reason: NotificationReason | null;
  unreadOnly: boolean;
  /** Only threads the app itself marked read last (sent to GitHub, or queued to be). */
  readByApp: boolean;
  /** Only threads with a mark-read waiting for the writes lock. */
  pendingOnly: boolean;
  /** Matched against repo#number, title, topic and tile title, case-insensitive. */
  text: string;
}

export const NO_NOTIFICATION_FILTER: NotificationFilter = { reason: null, unreadOnly: false, readByApp: false, pendingOnly: false, text: '' };

/** "acme/app#1902", or just the repo for subjects without a number. */
export function threadRef(row: NotificationDebugRow): string {
  return row.thread.number === null ? row.thread.repo : `${row.thread.repo}#${row.thread.number}`;
}

/** Short label for the "landed in" column. */
export function landingLabel(landing: NotificationLanding): string {
  switch (landing.kind) {
    case 'tile':
      return landing.unsorted ? `Unsorted › ${landing.tileTitle}` : `${landing.topicName} › ${landing.tileTitle}`;
    case 'not_pr':
      return 'not a PR';
    case 'pr_not_synced':
      return 'PR not synced';
    case 'no_topic':
      return 'no topic';
    case 'topic_hidden':
      return `${landing.topicName} (hidden)`;
    case 'no_tile':
      return `${landing.topicName}, no tile`;
  }
}

/** Why a row has no tile to jump to, shown inline when it is clicked. Null when it has one. */
export function noTileReason(landing: NotificationLanding): string | null {
  switch (landing.kind) {
    case 'tile':
      return null;
    case 'not_pr':
      return 'Not a pull request. Only PR threads become tiles.';
    case 'pr_not_synced':
      return 'The PR was never fetched: the sync stopped at its PR limit or the fetch failed. The hourly auto sync or Sync now picks it up.';
    case 'no_topic':
      return 'The PR is stored but sits in no topic and is not waiting in Unsorted.';
    case 'topic_hidden':
      return `Its topic "${landing.topicName}" was merged away or archived, so no tile shows it.`;
    case 'no_tile':
      return `It belongs to "${landing.topicName}", but no tile there holds it.`;
  }
}

/** Reasons present in the rows, in first-seen order, for the reason picker. */
export function reasonsIn(rows: NotificationDebugRow[]): NotificationReason[] {
  return [...new Set(rows.map((row) => row.thread.reason))];
}

function haystack(row: NotificationDebugRow): string {
  return [threadRef(row), row.thread.title, row.thread.subjectType, landingLabel(row.landing)].join(' ').toLowerCase();
}

/**
 * The app's own mark-read is the newest thing that happened to the thread:
 * sent to GitHub, or queued with writes on. Pending writes are not read yet.
 */
export function readByApp(row: NotificationDebugRow): boolean {
  const last = row.lastAction;
  return last !== null && last.action === 'mark_read' && (last.outcome === 'github' || (last.outcome === 'queued' && last.detail === ''));
}

/** A mark-read of this thread waits for the writes lock. */
export function pendingWrite(row: NotificationDebugRow): boolean {
  const last = row.lastAction;
  return last !== null && last.action === 'mark_read' && (last.outcome === 'pending' || (last.outcome === 'failed' && last.origin === 'footer'));
}

/** Rows that pass every filter; keeps the server's order (newest first). */
export function filterNotifications(rows: NotificationDebugRow[], filter: NotificationFilter): NotificationDebugRow[] {
  const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      (filter.reason === null || row.thread.reason === filter.reason) &&
      (!filter.unreadOnly || row.thread.unread) &&
      (!filter.readByApp || readByApp(row)) &&
      (!filter.pendingOnly || pendingWrite(row)) &&
      terms.every((term) => haystack(row).includes(term)),
  );
}

const WHO: Record<ActionOrigin, string> = {
  tile: 'you in a tile',
  debug: 'you in this view',
  queue: 'the deferred queue',
  quit: 'the queue on quit',
  sync: 'sync',
  poll: 'the live poll',
  footer: 'you from the lock',
  cleanup: 'you in the inbox cleanup',
  quiet: 'PostPile',
  agent: 'an outside agent',
};

/**
 * - app: the app reached GitHub
 * - local: only the app's own state changed
 * - problem: not sent, or failed
 * - outside: read on github.com or another client
 * - pending: waits for the writes lock
 */
export type ActionTone = 'app' | 'local' | 'problem' | 'outside' | 'pending';

export interface ActionLine {
  text: string;
  tone: ActionTone;
  /** Longer text for the tooltip: the log detail and the time. */
  title: string;
}

/** Detail of a mark-read GitHub did not take ("GitHub didn't take it: <reason>; still unread"). */
const NOT_TAKEN_PREFIX = "GitHub didn't take it";

function markReadText(last: ActionLogEntry, decidedBy: ActionLogEntry | null): { text: string; tone: ActionTone } {
  const who = WHO[last.origin];
  switch (last.outcome) {
    case 'github':
      if (last.origin === 'quiet') {
        // Handled quietly: the detail names the bots.
        return { text: 'marked read by PostPile: only bot activity since your last read', tone: 'app' };
      }
      return { text: `marked read by ${who}${decidedBy ? `, queued by ${WHO[decidedBy.origin]}` : ''}`, tone: 'app' };
    case 'queued':
      if (last.detail !== '') {
        return { text: `queued by ${who}, turns pending after the undo window (locked)`, tone: 'local' };
      }
      return { text: `queued by ${who}, reaches GitHub after the undo window`, tone: 'local' };
    case 'pending':
      return { text: `pending while locked · marked read by ${who}, not on GitHub yet`, tone: 'pending' };
    case 'discarded':
      return { text: 'pending mark-read discarded: unread, like on GitHub', tone: 'local' };
    case 'local':
      if (last.detail === 'no unread GitHub thread') {
        return { text: `marked read in the app by ${who}`, tone: 'local' };
      }
      // Older rows: a read-only mark-read changed the app only (before pending writes).
      return { text: `stayed local: read-only · marked read by ${decidedBy ? WHO[decidedBy.origin] : who}`, tone: 'local' };
    case 'skipped':
      if (last.detail.startsWith(NOT_TAKEN_PREFIX)) {
        return { text: `${last.detail} · sent by ${who}`, tone: 'problem' };
      }
      return { text: `left unread by ${who}: ${last.detail}`, tone: 'problem' };
    case 'failed':
      if (last.origin === 'footer') {
        return { text: 'pending mark-read failed to send, still pending', tone: 'problem' };
      }
      if (last.detail.startsWith(NOT_TAKEN_PREFIX)) {
        return { text: `${last.detail} · sent by ${who}`, tone: 'problem' };
      }
      return { text: `mark-read failed (${who})`, tone: 'problem' };
    case 'observed':
      if (last.origin === 'sync' || last.origin === 'poll') {
        return { text: `read on github.com or another client · noticed by ${who}`, tone: 'outside' };
      }
      return { text: 'already read on GitHub when the queue got to it', tone: 'outside' };
  }
}

function writeText(verb: string, last: ActionLogEntry): { text: string; tone: ActionTone } {
  if (last.outcome === 'github') {
    return { text: `${verb} by ${WHO[last.origin]}`, tone: 'app' };
  }
  if (last.outcome === 'failed') {
    return { text: `${verb}: failed`, tone: 'problem' };
  }
  return { text: `${verb}: not sent, GitHub writes were off`, tone: 'problem' };
}

function entryText(last: ActionLogEntry, decidedBy: ActionLogEntry | null): { text: string; tone: ActionTone } {
  switch (last.action) {
    case 'mark_read':
      return markReadText(last, decidedBy);
    case 'mark_all_read_before':
      return writeText('inbox cleanup (everything older marked read)', last);
    case 'undo_mark_read':
      return { text: `mark-read undone by ${WHO[last.origin]}`, tone: 'local' };
    case 'bring_back':
      // Old rows only: bring back was removed (GitHub has no mark-unread).
      return { text: `brought back in the app by ${WHO[last.origin]} (removed feature)`, tone: 'local' };
    case 'approve':
      return writeText('approved', last);
    case 'comment':
      return writeText('commented', last);
    case 'writes_on':
    case 'writes_off':
      return { text: last.action === 'writes_on' ? 'GitHub writes turned on' : 'GitHub writes turned off', tone: 'local' };
    case 'agent_refresh':
      // Logged without a thread or PR, so a debug row never shows it; here for completeness.
      return { text: `re-read from GitHub for ${WHO[last.origin]}`, tone: 'outside' };
  }
}

/**
 * What led to the row's read state, from the action log: "marked read by
 * the deferred queue, queued by you in a tile · 3m ago". A read thread the
 * app never touched reads as read somewhere else. Null for an unread thread
 * with nothing logged.
 */
export function actionLine(row: NotificationDebugRow, now: Date): ActionLine | null {
  const last = row.lastAction;
  if (last === null) {
    if (row.thread.unread) {
      return null;
    }
    return { text: 'read on github.com or another client', tone: 'outside', title: 'The app has no log entry for this thread.' };
  }
  const { text, tone } = entryText(last, row.decidedBy);
  const age = ageLabel(last.at, now);
  const title = [last.detail, `${last.action} · ${last.origin} · ${last.outcome} · ${last.at}`].filter(Boolean).join('\n');
  return { text: age === 'now' ? `${text} · just now` : `${text} · ${age} ago`, tone, title };
}

const DECIDED_BY: Record<PingDecision['source'], string> = {
  rules: 'the rules',
  agent: 'the agent',
  fallback: 'the fallback (agent unavailable)',
};

export interface PingDecisionLine {
  text: string;
  /** Pinged reads stronger than withheld. */
  pinged: boolean;
  /** The ping's title and body when it pinged, and the time. */
  title: string;
}

/** "withheld by the agent: the mention is an FYI · 3h ago" / "pinged by the rules: …". */
export function pingDecisionLine(decision: PingDecision, now: Date): PingDecisionLine {
  const verb = decision.ping ? 'pinged' : 'withheld';
  const age = ageLabel(decision.at, now);
  const when = age === 'now' ? 'just now' : `${age} ago`;
  const reason = decision.reason === '' ? '' : `: ${decision.reason}`;
  const title = [decision.ping ? [decision.title, decision.body].filter(Boolean).join('\n') : '', decision.at].filter(Boolean).join('\n');
  return { text: `${verb} by ${DECIDED_BY[decision.source]}${reason} · ${when}`, pinged: decision.ping, title };
}
