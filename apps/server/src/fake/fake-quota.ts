import { GitHubQuota } from '@postpile/engine';

/**
 * What POSTPILE_FAKE_QUOTA can simulate (DESIGN.md "GitHub quota"): the
 * GitHub quota low (background sync waits, the live poll slows) or nearly
 * used (the live poll waits too).
 */
export type FakeQuotaLevel = 'low' | 'critical';

/** Sample data's GraphQL limit resets this long after start. */
const RESET_MS = 35 * 60_000;
const LIMIT = 5000;
const REMAINING: Record<FakeQuotaLevel, number> = { low: 2000, critical: 600 };

/** "low" or "critical"; anything else (or unset) means a quota with plenty left. */
export function fakeQuotaLevel(value: string | undefined): FakeQuotaLevel | null {
  const word = value?.trim().toLowerCase();
  return word === 'low' || word === 'critical' ? word : null;
}

/** The real quota tracker, fed one sample GraphQL reading when a level is asked for. */
export function fakeQuota(level: FakeQuotaLevel | null, now: () => Date): GitHubQuota {
  const quota = new GitHubQuota(() => now().getTime());
  if (level !== null) {
    quota.note({ resource: 'graphql', limit: LIMIT, remaining: REMAINING[level], resetAtMs: now().getTime() + RESET_MS });
  }
  return quota;
}
