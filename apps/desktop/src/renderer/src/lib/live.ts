import type { LivePollStatus } from '@postpile/core';
import { clockLabel } from './time.ts';

export interface LiveLabel {
  text: string;
  /** Rate limited or failing: the footer tints it. */
  warn: boolean;
  title: string;
}

function secondsUntil(iso: string | null, now: Date): number {
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 1000)) : 0;
}

/** Footer text for the fast notification poll. */
export function liveLabel(status: LivePollStatus | undefined, now: Date): LiveLabel {
  if (!status || status.state === 'off') {
    return { text: 'live poll off', warn: false, title: 'The desktop app polls GitHub notifications; POSTPILE_POLL_SECONDS=0 turns it off' };
  }
  const github = status.githubPollIntervalSeconds === null ? 'no X-Poll-Interval yet' : `GitHub asks for ${status.githubPollIntervalSeconds}s (X-Poll-Interval)`;
  // A low GitHub quota slows the poll; the engine says to what.
  const every = status.githubQuota?.pollSeconds ?? status.everySeconds;
  const title = `Polling every ${every}s (set to ${status.intervalSeconds}s, ${github}) and when you switch to the app. ${status.notificationsShown} Mac notifications so far.`;
  if (status.state === 'backoff') {
    return { text: `live · backing off, retry in ${secondsUntil(status.backoffUntil, now)}s`, warn: true, title: `${status.note ?? ''}. ${title}` };
  }
  if (status.state === 'blocked') {
    return { text: `live · paused: ${status.note ?? 'busy'}`, warn: false, title };
  }
  return { text: `live · every ${every}s`, warn: false, title };
}

/** The footer's quota item: null while the quota is fine (the footer stays quiet), else what waits and until when. */
export function quotaLabel(status: LivePollStatus | undefined): LiveLabel | null {
  const quota = status?.githubQuota;
  if (!quota) {
    return null;
  }
  const until = clockLabel(new Date(quota.resumeAt));
  const resource = quota.resource === 'graphql' ? 'GraphQL' : 'REST';
  const shared = 'PostPile shares the hourly GitHub limit with your gh and other tools, and leaves at least half of it to them. Sync now still works.';
  if (quota.level === 'critical') {
    return {
      text: `GitHub quota nearly used: background sync and live poll paused until ${until}`,
      warn: true,
      title: `${resource}: ${quota.remainingPercent}% of the hourly limit left. ${shared}`,
    };
  }
  return {
    text: `GitHub quota low: background sync paused until ${until}`,
    warn: true,
    title: `${resource}: ${quota.remainingPercent}% of the hourly limit left; the live poll slows down. ${shared}`,
  };
}
