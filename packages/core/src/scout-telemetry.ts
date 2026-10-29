// Telemetry for scouted PRs leaving the Scouted section (DESIGN.md "Usage
// analytics" › Scouts): how each one left, decided from its stored row only.
// Counts, booleans and an enum: never the PR, the scout or its reason.
import type { ScoutedPr } from './scouts.ts';
import type { ScoutClosedOutcome, TelemetryEventProps } from './telemetry-events.ts';
import type { IsoTime } from './types.ts';

const HOUR_MS = 60 * 60 * 1000;

/** A scouted PR whose leaving is not recorded yet, as the store lists it. */
export interface ScoutedLeaving {
  scouted: Pick<ScoutedPr, 'pulledAt' | 'seenUpdatedAt' | 'followedAt' | 'dismissedAt' | 'expiredAt' | 'expiryReason'>;
  /** PostPile tracks the PR, or a layer of its stack, by itself: a notification thread, found by the sync, or in a topic. */
  tracked: boolean;
  /** The PR's stored update time; null without a stored header. */
  prUpdatedAt: IsoTime | null;
}

/**
 * How a scouted PR left the Scouted section and when, or null while it is
 * still there. Follow, dismiss and expiry are stored with their time; the
 * earliest by time wins should a row hold two (a Follow from the detail pane
 * after an expiry). A PR that became tracked by itself left `now`.
 */
export function scoutClosedOutcome(leaving: ScoutedLeaving, now: IsoTime): { outcome: ScoutClosedOutcome; at: IsoTime } | null {
  const { scouted } = leaving;
  const stored: { outcome: ScoutClosedOutcome; at: IsoTime }[] = [];
  if (scouted.followedAt !== null) {
    stored.push({ outcome: 'followed', at: scouted.followedAt });
  }
  if (scouted.dismissedAt !== null) {
    stored.push({ outcome: 'dismissed', at: scouted.dismissedAt });
  }
  if (scouted.expiredAt !== null) {
    stored.push({ outcome: `expired_${scouted.expiryReason ?? 'inactive'}`, at: scouted.expiredAt });
  }
  if (stored.length > 0) {
    return stored.sort((a, b) => a.at.localeCompare(b.at))[0]!;
  }
  if (leaving.tracked) {
    return { outcome: 'reached_inbox', at: now };
  }
  return null;
}

/** scout_pr_closed's props for a PR that left at `at` with `outcome`. */
export function scoutPrClosedProps(leaving: ScoutedLeaving, outcome: ScoutClosedOutcome, at: IsoTime): TelemetryEventProps<'scout_pr_closed'> {
  const { seenUpdatedAt, pulledAt } = leaving.scouted;
  const wasSeen = seenUpdatedAt !== null && leaving.prUpdatedAt !== null && seenUpdatedAt >= leaving.prUpdatedAt;
  const hours = Math.round((Date.parse(at) - Date.parse(pulledAt)) / HOUR_MS);
  return {
    outcome,
    was_seen: wasSeen,
    was_opened: seenUpdatedAt !== null,
    hours_in_section: Math.max(0, hours),
  };
}
