// Words for the busy inbox card in the sidebar (DESIGN.md "Big inboxes: what
// PostPile loads and works on"). The rule (cap, tiers, what is kept) is
// core's; this only words what GET /api/busy-inbox sent.
import type { BusyInboxView, InboxCleanupView } from '@postpile/core';
import { CLEANUP_PENDING_NOTE, cleanupLine, type LeadPart } from './cleanup.ts';

/** "4,640": grouped the same way on every machine, so the card reads like the mockup. */
export function countText(count: number): string {
  return count.toLocaleString('en-US');
}

/** The card's sentence, the number apart so it can be set in mono: "Focusing on what is aimed at you. 4,640 quiet PRs wait for news." */
export function leadParts(view: BusyInboxView): LeadPart[] {
  const rest = view.quietPrs === 1 ? ' quiet PR waits for news.' : ' quiet PRs wait for news.';
  return ['Focusing on what is aimed at you. ', { count: view.quietPrs }, rest];
}

/** One kept tier on the card: "940 for you". */
export interface KeptTier {
  label: string;
  count: number;
}

/** What the board keeps per tier, in the board's order: you, your team, others. */
export function keptTiers(view: BusyInboxView): KeptTier[] {
  return [
    { label: 'for you', count: view.keptYou },
    { label: 'for your team', count: view.keptTeam },
    { label: 'for others', count: view.keptOthers },
  ];
}

/** The collapsed card's one line: "Busy inbox · 4,640 quiet PRs". */
export function collapsedText(view: BusyInboxView): string {
  return `Busy inbox · ${countText(view.quietPrs)} quiet ${view.quietPrs === 1 ? 'PR' : 'PRs'}`;
}

/**
 * "Why?": what PostPile does now, in plain words. Calm on purpose: it is
 * focusing, nothing broke. It never mentions the GitHub writes lock: that
 * lives in the footer only (2026-10-05).
 */
export function whyLines(view: BusyInboxView): string[] {
  // Threads updated in the last hour are active this week, so they are part of the inbox count.
  const lastHour = view.updatesLastHour > 0 ? `, ${countText(view.updatesLastHour)} of them updated in the last hour` : '';
  return [
    `${countText(view.inboxPrs)} PRs are open, unread or active this week${lastHour}. PostPile works on ${countText(view.cap)} at a time.`,
    "It keeps your PRs and what is aimed at you, then your team's.",
    "Other people's PRs wait, with no fetching and no agent work. Nothing is deleted.",
    `This goes away by itself once your inbox is back under ${countText(view.cap)}.`,
  ];
}

/** Why "Clean up" is off, null when it opens the cleanup dialog. Same rules as the sidebar footer's "Clear". */
export function cleanUpBlocked(cleanup: InboxCleanupView | undefined): string | null {
  if (cleanup === undefined) {
    return 'Counting what can be cleaned up…';
  }
  if (cleanup.running) {
    return 'A cleanup is running; the footer shows its progress.';
  }
  if (cleanup.pending) {
    return CLEANUP_PENDING_NOTE;
  }
  if (cleanupLine(cleanup) === null) {
    return 'Nothing to clean up: no unread merged PRs or old notifications.';
  }
  return null;
}
