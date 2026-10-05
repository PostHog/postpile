// A PR's checks in a few numbers (DESIGN.md "CI is not a signal"). Nothing
// in PostPile reads a single check context: the PR pane counts them, the CI
// event reads the rollup, the newest finish time and the failing names.
// Rules only, no IO.
import type { CheckRollup, Checks, IsoTime } from './types.ts';

/** Conclusions that count as passed: success, plus neutral and skipped, which never block a merge. */
const PASSED_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export interface ChecksSummary {
  rollup: CheckRollup;
  /** Contexts on the head commit as fetched (the query takes the first 100), so not always every check. */
  total: number;
  /** SUCCESS, NEUTRAL, SKIPPED. */
  passed: number;
  /** Any other conclusion: FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, … */
  failed: number;
  /** No conclusion yet: still running or queued. */
  pending: number;
  /** The newest completedAt among them; null when none finished. */
  finishedAt: IsoTime | null;
  /** Names of the contexts whose conclusion is FAILURE, in context order: what the CI event names. */
  failedNames: string[];
}

/**
 * The summary of one PR's checks. Counts follow the PR pane's Checks fact
 * (failed and still running both read as "not passing" there);
 * `finishedAt` and `failedNames` are what the CI event reads (`ciEvent`).
 */
export function summarizeChecks(checks: Checks): ChecksSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let finishedAt: IsoTime | null = null;
  const failedNames: string[] = [];
  for (const context of checks.contexts) {
    if (context.conclusion === null) {
      pending += 1;
    } else if (PASSED_CONCLUSIONS.has(context.conclusion)) {
      passed += 1;
    } else {
      failed += 1;
    }
    if (context.conclusion === 'FAILURE') {
      failedNames.push(context.name);
    }
    if (context.completedAt !== null && (finishedAt === null || context.completedAt > finishedAt)) {
      finishedAt = context.completedAt;
    }
  }
  return { rollup: checks.rollup, total: checks.contexts.length, passed, failed, pending, finishedAt, failedNames };
}
