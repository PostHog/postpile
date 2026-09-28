import { describe, expect, it } from 'vitest';
import { sweepDue, workContextPromptText, type WorkContextVersion } from './work-context.ts';

/** Local time, so the morning rule reads the same in every time zone. */
function local(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 8, day, hour, minute);
}

describe('sweepDue', () => {
  const never = { lastSuccessAt: null, lastFailureAt: null };

  it('waits for the morning, from 06:00 local time', () => {
    expect(sweepDue(local(28, 5, 59), never)).toBe(false);
    expect(sweepDue(local(28, 6, 0), never)).toBe(true);
    expect(sweepDue(local(28, 23, 30), never)).toBe(true);
  });

  it('runs once per 24 hours after a success', () => {
    const history = { lastSuccessAt: local(27, 7).toISOString(), lastFailureAt: null };
    expect(sweepDue(local(28, 6, 30), history)).toBe(false);
    expect(sweepDue(local(28, 7, 0), history)).toBe(true);
  });

  it('never runs at night, even when the last success is old', () => {
    expect(sweepDue(local(28, 3), { lastSuccessAt: local(20, 7).toISOString(), lastFailureAt: null })).toBe(false);
  });

  it('waits two hours after a failure', () => {
    const history = { lastSuccessAt: null, lastFailureAt: local(28, 8).toISOString() };
    expect(sweepDue(local(28, 9, 59), history)).toBe(false);
    expect(sweepDue(local(28, 10, 0), history)).toBe(true);
  });
});

describe('workContextPromptText', () => {
  const version: Pick<WorkContextVersion, 'digest' | 'createdAt'> = {
    createdAt: '2026-09-28T07:00:00.000Z',
    digest: {
      summary: 'Julian drives the Depot CI move.',
      threads: [
        { title: 'Depot rollout', detail: 'Rolling out to posthog.', topicIds: ['t1', 'gone'], sources: [] },
        { title: 'Runner image bump', detail: 'Waiting on review.', topicIds: [], sources: [] },
      ],
      lastSeenAt: null,
    },
  };

  it('is compact: date, summary, one line per thread with topic names', () => {
    expect(workContextPromptText(version, new Map([['t1', 'Move CI to Depot']]), new Set())).toBe(
      [
        'As of 2026-09-28: Julian drives the Depot CI move.',
        'Threads:',
        '- Depot rollout: Rolling out to posthog. (topics: Move CI to Depot)',
        '- Runner image bump: Waiting on review.',
      ].join('\n'),
    );
  });

  it('leaves forgotten threads out right away', () => {
    const text = workContextPromptText(version, new Map(), new Set(['runner image bump']));
    expect(text).not.toContain('Runner image bump');
  });
});

describe('workContextPromptText bounds', () => {
  it('cuts long details and keeps whole threads only', () => {
    const threads = Array.from({ length: 30 }, (_, i) => ({ title: `Thread ${i}`, detail: 'd'.repeat(500), topicIds: [], sources: [] }));
    const text = workContextPromptText({ createdAt: '2026-09-28T07:00:00.000Z', digest: { summary: 'Busy.', threads, lastSeenAt: null } }, new Map(), new Set());
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text.split('\n').at(-1)).toMatch(/^- Thread \d+: d+…$/);
  });
});
