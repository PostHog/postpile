import type { MacNotification, Ping, PingTarget } from '@postpile/core';

/** At most one notification per tile in this window. */
export const PING_TILE_WINDOW_MS = 2 * 60 * 1000;

/** More pings than this in one cycle become one summary. */
export const PINGS_BEFORE_SUMMARY = 3;

/** Titles a summary lists before "and N more". */
const SUMMARY_LINES = 3;

function tileKey(target: PingTarget): string {
  return target.tileId ?? `pr:${target.prKey}`;
}

function single(ping: Ping): MacNotification {
  return { title: ping.title, body: ping.body, target: ping.target, count: 1, personal: ping.personal };
}

function summary(pings: Ping[]): MacNotification {
  const lines = pings.slice(0, SUMMARY_LINES).map((ping) => ping.title);
  const more = pings.length - lines.length;
  if (more > 0) {
    lines.push(`and ${more} more`);
  }
  return { title: `${pings.length} PRs need you`, body: lines.join('\n'), target: pings[0]!.target, count: pings.length, personal: pings.some((ping) => ping.personal) };
}

/**
 * Keeps bursts from flooding the Mac: a tile pinged in the last two minutes
 * stays quiet, and a cycle with more than three pings shows one summary.
 * Lives as long as the poller; a restart forgets the window.
 */
export class PingThrottle {
  private readonly lastShown = new Map<string, number>();

  private forget(nowMs: number): void {
    for (const [key, at] of this.lastShown) {
      if (nowMs - at >= PING_TILE_WINDOW_MS) {
        this.lastShown.delete(key);
      }
    }
  }

  plan(pings: Ping[], nowMs: number): MacNotification[] {
    this.forget(nowMs);
    const kept: Ping[] = [];
    for (const ping of pings) {
      const key = tileKey(ping.target);
      if (this.lastShown.has(key)) {
        continue;
      }
      this.lastShown.set(key, nowMs);
      kept.push(ping);
    }
    if (kept.length > PINGS_BEFORE_SUMMARY) {
      return [summary(kept)];
    }
    return kept.map(single);
  }
}
