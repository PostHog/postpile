import { describe, expect, it } from 'vitest';
import { summarizeChecks } from './checks.ts';
import { deriveEvents } from './events.ts';
import { at, makePr, viewer } from './fixtures.ts';
import type { CheckContext, Checks } from './types.ts';

function context(name: string, conclusion: string | null, minutes: number | null): CheckContext {
  return { name, conclusion, completedAt: minutes === null ? null : at(minutes) };
}

const mixed: Checks = {
  rollup: 'FAILURE',
  contexts: [
    context('lint', 'SUCCESS', 3),
    context('docs', 'SKIPPED', 1),
    context('size', 'NEUTRAL', 2),
    context('test', 'FAILURE', 7),
    context('deploy', 'CANCELLED', 4),
    context('e2e', null, null),
    context('types', 'FAILURE', 5),
  ],
};

describe('summarizeChecks', () => {
  it('counts success, neutral and skipped as passed, other conclusions as failed, no conclusion as pending', () => {
    expect(summarizeChecks(mixed)).toMatchObject({ rollup: 'FAILURE', total: 7, passed: 3, failed: 3, pending: 1 });
  });

  it('keeps the newest finish time and the FAILURE names in context order', () => {
    const summary = summarizeChecks(mixed);
    expect(summary.finishedAt).toBe(at(7));
    // A cancelled run counts as failed but is not named, like in the CI event.
    expect(summary.failedNames).toEqual(['test', 'types']);
  });

  it('says nothing finished while every check still runs, and handles no checks', () => {
    expect(summarizeChecks({ rollup: 'PENDING', contexts: [context('e2e', null, null)] })).toEqual({
      rollup: 'PENDING',
      total: 1,
      passed: 0,
      failed: 0,
      pending: 1,
      finishedAt: null,
      failedNames: [],
    });
    expect(summarizeChecks({ rollup: 'NONE', contexts: [] })).toEqual({
      rollup: 'NONE',
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      finishedAt: null,
      failedNames: [],
    });
  });

  it('holds what the CI event reads: its time and the names in its summary', () => {
    const pr = makePr({ headOid: 'abc', checks: mixed });
    const ci = deriveEvents(pr, viewer, null).find((event) => event.kind === 'ci');
    const summary = summarizeChecks(mixed);
    expect(ci?.at).toBe(summary.finishedAt);
    expect(ci?.summary).toBe(`CI failed: ${summary.failedNames.join(', ')}`);
  });
});
