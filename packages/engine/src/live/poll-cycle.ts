import type { MacNotification, Ping, PingDecision } from '@postpile/core';

/**
 * One fast-poll cycle, as the engine reports it to the scheduler. Rate
 * limits and other failures are thrown, not returned: the scheduler backs off.
 */
export type PollCycle =
  | { kind: 'blocked'; reason: string }
  | {
      kind: 'done';
      notModified: boolean;
      githubPollIntervalSeconds: number | null;
      prsUpdated: number;
      decisions: PingDecision[];
      pings: Ping[];
      errors: string[];
    };

export interface LivePollOptions {
  /** 0 or less keeps the poll off. */
  intervalSeconds: number;
  /** Called with what to show; a burst is already grouped. Answers whether they reached the Mac (false: notifications off or unsupported). */
  onNotify: (notifications: MacNotification[]) => boolean;
  /** Defaults to console.log. */
  log?: (message: string) => void;
}
