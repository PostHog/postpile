import type { LivePollStatus } from '@code-manager/core';

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
    return { text: 'live poll off', warn: false, title: 'The desktop app polls GitHub notifications; CODE_MANAGER_POLL_SECONDS=0 turns it off' };
  }
  const github = status.githubPollIntervalSeconds === null ? 'no X-Poll-Interval yet' : `GitHub asks for ${status.githubPollIntervalSeconds}s (X-Poll-Interval)`;
  const title = `Polling every ${status.intervalSeconds}s, ${github}. ${status.notificationsShown} Mac notifications so far.`;
  if (status.state === 'backoff') {
    return { text: `live · backing off, retry in ${secondsUntil(status.backoffUntil, now)}s`, warn: true, title: `${status.note ?? ''}. ${title}` };
  }
  if (status.state === 'blocked') {
    return { text: `live · paused: ${status.note ?? 'busy'}`, warn: false, title };
  }
  return { text: `live · every ${status.intervalSeconds}s`, warn: false, title };
}
