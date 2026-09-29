import { quietReadDetail, type NewActionLogEntry } from '@postpile/core';
import { SAMPLE_REPO } from './sample-builders.ts';

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

/** Sample PRs whose read threads came back only because of bots, and which bots. Invented. */
const QUIET_SAMPLES: { number: number; bots: string[]; hoursAgo: number }[] = [
  { number: 1904, bots: ['trunk-io[bot]', 'CI'], hoursAgo: 2 },
  { number: 1899, bots: ['github-actions[bot]'], hoursAgo: 26 },
  { number: 1921, bots: ['renovate[bot]', 'CI'], hoursAgo: 50 },
  { number: 1963, bots: ['chatgpt-codex-connector[bot]', 'coderabbitai[bot]'], hoursAgo: 75 },
  // Older than the view's 7 days: in the log, not in "Handled quietly".
  { number: 1855, bots: ['vercel[bot]'], hoursAgo: 9 * 24 },
];

/**
 * Action log rows as the real sync writes them for "Handled quietly", on
 * sample threads that are read. Oldest first, so the log ids grow with time.
 */
export function sampleQuietReads(now: Date): NewActionLogEntry[] {
  return QUIET_SAMPLES.toSorted((a, b) => b.hoursAgo - a.hoursAgo).map((sample) => ({
    at: hoursBefore(now, sample.hoursAgo),
    action: 'mark_read',
    origin: 'quiet',
    outcome: 'github',
    threadId: `sample-thread-${sample.number}`,
    prKey: `${SAMPLE_REPO}#${sample.number}`,
    tileId: null,
    batch: null,
    detail: quietReadDetail(sample.bots),
  }));
}
