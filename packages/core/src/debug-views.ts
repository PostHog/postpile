// Read models for the debug view of the raw GitHub notification stream.

import type { ActionLogEntry } from './github-writes.ts';
import type { EventKind, IsoTime, Loudness, NotificationThread, PrKey, TileStateKind } from './types.ts';

/** Rows the debug endpoint returns when the request names no limit, and at most. */
export const DEBUG_NOTIFICATIONS_DEFAULT_LIMIT = 200;
export const DEBUG_NOTIFICATIONS_MAX_LIMIT = 1000;

/** Logged events shown per PR when a debug row is expanded, newest first. */
export const DEBUG_EVENTS_PER_PR = 5;

/**
 * Where a notification thread ended up in the app.
 * - tile: shown in a tile (Unsorted counts, flagged with `unsorted`).
 * - not_pr: issues, releases, discussions; only PR threads become tiles.
 * - pr_not_synced: a PR thread whose PR was never fetched (sync limit, error).
 * - no_topic: the PR is stored but sits in no topic and is not unsorted.
 * - topic_hidden: the PR's topic is merged away, archived or retired.
 * - no_tile: the topic is live but no tile holds the PR.
 */
export type NotificationLanding =
  | {
      kind: 'tile';
      topicId: string;
      topicName: string;
      tileId: string;
      tileTitle: string;
      tileState: TileStateKind;
      unsorted: boolean;
    }
  | { kind: 'not_pr' }
  | { kind: 'pr_not_synced' }
  | { kind: 'no_topic' }
  | { kind: 'topic_hidden'; topicId: string; topicName: string }
  | { kind: 'no_tile'; topicId: string; topicName: string };

/** One stored PR event, trimmed for the debug view. */
export interface DebugEventLine {
  id: string;
  kind: EventKind;
  actor: string;
  at: IsoTime;
  summary: string;
  /** The agent's override if any, else the rule's. */
  loudness: Loudness;
  seen: boolean;
}

/** One stored notification thread, as GitHub sent it, plus where it landed. */
export interface NotificationDebugRow {
  thread: NotificationThread;
  /** Set for PullRequest threads with a number. */
  prKey: PrKey | null;
  landing: NotificationLanding;
  /** Up to DEBUG_EVENTS_PER_PR stored events of the PR, newest first. Empty for non-PR threads. */
  recentEvents: DebugEventLine[];
  /**
   * The newest action log entry for the thread or its PR. Null when the app
   * never acted on it: a read thread then was read on github.com or another client.
   */
  lastAction: ActionLogEntry | null;
  /** When lastAction is a queue send: the entry of the click that queued it (same batch). */
  decidedBy: ActionLogEntry | null;
}
