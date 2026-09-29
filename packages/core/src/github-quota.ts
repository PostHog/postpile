import type { IsoTime } from './types.ts';

// PostPile reads GitHub with the user's own `gh auth token`, so it shares the
// hourly quota (REST core 5000 requests, GraphQL 5000 points) with their gh
// CLI and every other tool (DESIGN.md "GitHub quota"). PostPile never uses
// all of it: with half or less left, optional background work waits for the
// reset; with a fifth or less left, the live poll waits too. These are the
// pure rules; the engine keeps the latest readings in memory.

/** The limits PostPile budgets. Others (search) have small per-minute windows of their own and are left out. */
export const QUOTA_RESOURCES = ['core', 'graphql'] as const;
export type QuotaResource = (typeof QUOTA_RESOURCES)[number];

/** ok: background work runs. low: optional background work waits. critical: the live poll waits too. */
export type QuotaLevel = 'ok' | 'low' | 'critical';

/** At or below this share left (percent), the level is low. */
export const QUOTA_LOW_PERCENT = 50;
/** At or below this share left (percent), the level is critical. */
export const QUOTA_CRITICAL_PERCENT = 20;
/** While the quota is low, the live poll runs at most this often. */
export const LOW_QUOTA_POLL_SECONDS = 60;

const LEVEL_RANK: Record<QuotaLevel, number> = { ok: 0, low: 1, critical: 2 };

/** One resource's X-RateLimit-* headers from a GitHub answer. */
export interface QuotaReading {
  resource: QuotaResource;
  limit: number;
  remaining: number;
  /** X-RateLimit-Reset (epoch seconds) in epoch ms: the limit is full again from then. */
  resetAtMs: number;
}

/** The quota as the status footer shows it; only sent while it is not ok. */
export interface GitHubQuotaView {
  level: 'low' | 'critical';
  /** The limit with the smallest share left. */
  resource: QuotaResource;
  remainingPercent: number;
  /** When background GitHub work runs again: the latest reset among the limits holding it back. */
  resumeAt: IsoTime;
  /** How often the live poll runs now; null while it waits for the reset. */
  pollSeconds: number | null;
}

function isQuotaResource(value: string): value is QuotaResource {
  return (QUOTA_RESOURCES as readonly string[]).includes(value);
}

/** A whole number, or null for a missing or unreadable header. */
function numberHeader(header: (name: string) => string | null, name: string): number | null {
  const text = header(name);
  const value = Number(text ?? '');
  return text !== null && text.trim() !== '' && Number.isFinite(value) ? value : null;
}

/**
 * The reading an answer's headers carry, or null when it carries none or it
 * is about a limit PostPile does not budget. GraphQL answers say `graphql`
 * in X-RateLimit-Resource, REST answers `core`.
 */
export function quotaReadingOf(header: (name: string) => string | null): QuotaReading | null {
  const resource = header('x-ratelimit-resource');
  const limit = numberHeader(header, 'x-ratelimit-limit');
  const remaining = numberHeader(header, 'x-ratelimit-remaining');
  const reset = numberHeader(header, 'x-ratelimit-reset');
  if (resource === null || !isQuotaResource(resource) || limit === null || limit <= 0 || remaining === null || reset === null) {
    return null;
  }
  return { resource, limit, remaining: Math.max(0, remaining), resetAtMs: reset * 1000 };
}

/** Whole percent left, 0 to 100, rounded down. */
export function quotaPercent(remaining: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((remaining / limit) * 100)));
}

/** ok above half left, low at half or less, critical at a fifth or less. Compared exactly, not on the rounded percent. */
export function quotaLevel(remaining: number, limit: number): QuotaLevel {
  if (limit <= 0) {
    return 'ok';
  }
  if (remaining * 100 <= limit * QUOTA_CRITICAL_PERCENT) {
    return 'critical';
  }
  return remaining * 100 <= limit * QUOTA_LOW_PERCENT ? 'low' : 'ok';
}

function levelOf(reading: QuotaReading): QuotaLevel {
  return quotaLevel(reading.remaining, reading.limit);
}

/**
 * The reading to keep for a resource. Requests run side by side, so answers
 * can arrive out of order: within one window (same reset) the lower
 * remaining wins, so the level never flips back and forth at a threshold.
 */
export function mergeQuotaReading(last: QuotaReading | undefined, next: QuotaReading): QuotaReading {
  if (last && last.resetAtMs === next.resetAtMs && last.remaining < next.remaining) {
    return last;
  }
  return next;
}

/**
 * The level a new (merged) reading reached when it is worse than the last
 * one, else null. A last reading whose reset has passed counts as ok, so
 * every window can report its own drop once.
 */
export function quotaWorsened(last: QuotaReading | undefined, next: QuotaReading, nowMs: number): QuotaLevel | null {
  const before = last && last.resetAtMs > nowMs ? levelOf(last) : 'ok';
  const after = levelOf(next);
  return LEVEL_RANK[after] > LEVEL_RANK[before] ? after : null;
}

export interface QuotaState {
  level: QuotaLevel;
  /** The reading with the smallest share left, null at ok. */
  worst: QuotaReading | null;
  /** When every limit that holds background work back has reset; null at ok. */
  backgroundResumeAtMs: number | null;
  /** When every critical limit has reset; null unless critical. */
  pollResumeAtMs: number | null;
}

/**
 * Where the quota stands now. A reading whose reset has passed is ignored:
 * the limit is full again, whatever the last answer said, so paused work
 * resumes at the reset without a request to find out.
 */
export function quotaState(readings: QuotaReading[], nowMs: number): QuotaState {
  let worst: QuotaReading | null = null;
  let backgroundResumeAtMs: number | null = null;
  let pollResumeAtMs: number | null = null;
  for (const reading of readings) {
    const level = levelOf(reading);
    if (reading.resetAtMs <= nowMs || level === 'ok') {
      continue;
    }
    backgroundResumeAtMs = Math.max(backgroundResumeAtMs ?? 0, reading.resetAtMs);
    if (level === 'critical') {
      pollResumeAtMs = Math.max(pollResumeAtMs ?? 0, reading.resetAtMs);
    }
    if (worst === null || reading.remaining / reading.limit < worst.remaining / worst.limit) {
      worst = reading;
    }
  }
  return { level: worst ? levelOf(worst) : 'ok', worst, backgroundResumeAtMs, pollResumeAtMs };
}

/** How often the live poll runs at this level: its interval at ok, at least LOW_QUOTA_POLL_SECONDS when low. Null while critical: it waits for the reset. */
export function quotaPollSeconds(state: QuotaState, intervalSeconds: number): number | null {
  if (state.level === 'critical') {
    return null;
  }
  return state.level === 'low' ? Math.max(intervalSeconds, LOW_QUOTA_POLL_SECONDS) : intervalSeconds;
}

/** The footer's view, null at ok (the footer stays quiet then). */
export function quotaView(state: QuotaState, intervalSeconds: number): GitHubQuotaView | null {
  if (state.level === 'ok' || state.worst === null || state.backgroundResumeAtMs === null) {
    return null;
  }
  return {
    level: state.level,
    resource: state.worst.resource,
    remainingPercent: quotaPercent(state.worst.remaining, state.worst.limit),
    resumeAt: new Date(state.backgroundResumeAtMs).toISOString(),
    pollSeconds: quotaPollSeconds(state, intervalSeconds),
  };
}
