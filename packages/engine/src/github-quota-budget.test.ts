// The engine keeps well under the GitHub quota (DESIGN.md "GitHub quota"):
// the hourly auto sync waits while it is low, a sync the user asked for runs
// anyway, the footer hears about it, and telemetry gets the numbers.
import { makeThreadFor } from '@postpile/core/fixtures';
import type { QuotaReading } from '@postpile/core';
import { GitHubError } from '@postpile/github';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const MINUTE = 60 * 1000;
const pr = reviewRequestedPr(1);

function reading(h: Harness, overrides: Partial<QuotaReading> = {}): QuotaReading {
  return { resource: 'graphql', limit: 5000, remaining: 2000, resetAtMs: h.timers.now() + 30 * MINUTE, ...overrides };
}

describe('GitHub quota in the engine', () => {
  it('reports the requests and the lowest share left on sync_completed', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    const answers = [reading(h, { resource: 'core', remaining: 4900 }), reading(h, { remaining: 4500 })];
    h.reader.onListNotifications = () => {
      for (const answer of answers) {
        h.quota.note(answer);
      }
    };

    await h.engine.sync({ maxAgentCalls: 0 });

    const props = h.telemetry.events.find((e) => e.event === 'sync_completed')?.props;
    expect(props).toMatchObject({ gh_requests: 2, gh_core_remaining_pct: 98, gh_graphql_remaining_pct: 90 });
  });

  it('leaves the percentages out when no answer carried them', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });

    const props = h.telemetry.events.find((e) => e.event === 'sync_completed')?.props as Record<string, unknown>;
    expect(props.gh_requests).toBe(0);
    expect(props).not.toHaveProperty('gh_core_remaining_pct');
    expect(props).not.toHaveProperty('gh_graphql_remaining_pct');
  });

  it('sends github_quota_low once per drop, not per request', () => {
    const h = makeHarness();
    h.quota.note(reading(h, { remaining: 2400 }));
    h.quota.note(reading(h, { remaining: 2300 }));
    h.quota.note(reading(h, { remaining: 900 }));

    expect(h.telemetry.events).toEqual([
      { event: 'github_quota_low', props: { resource: 'graphql', level: 'low' } },
      { event: 'github_quota_low', props: { resource: 'graphql', level: 'critical' } },
    ]);
  });

  it('runs a sync the user asks for while the quota is low, and logs it', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    h.reader.addPr(pr, makeThreadFor(pr));
    h.quota.note(reading(h, { remaining: 600 }));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsFetched).toBe(1);
    expect(lines).toContain('sync: GitHub quota low (graphql 12% left), running anyway: not a background sync');
  });

  it('holds the hourly auto sync until the reset', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    h.engine.startAutoSync({ minutes: 60, maxAgentCalls: 0 });
    h.quota.note(reading(h, { resetAtMs: h.timers.now() + 90 * MINUTE }));

    h.timers.advance(60 * MINUTE);
    await Promise.resolve();
    expect(h.reader.notificationCalls).toBe(0);
    expect((await h.engine.livePollStatus()).nextAutoSyncAt).toBe(new Date(h.timers.now() + 30 * MINUTE).toISOString());

    h.timers.advance(30 * MINUTE);
    await vi.waitFor(() => expect(h.reader.notificationCalls).toBe(1));
    h.engine.stopAutoSync();
  });

  it('tells the footer while the quota is low, and nothing while it is ok', async () => {
    const h = makeHarness();
    expect((await h.engine.livePollStatus()).githubQuota).toBeNull();

    h.engine.startLivePoll({ intervalSeconds: 10, onNotify: () => {} });
    h.quota.note(reading(h));
    expect((await h.engine.livePollStatus()).githubQuota).toEqual({
      level: 'low',
      resource: 'graphql',
      remainingPercent: 40,
      resumeAt: new Date(h.timers.now() + 30 * MINUTE).toISOString(),
      pollSeconds: 60,
    });
    h.engine.stopLivePoll();
  });

  it('sends rate_limited from the poll when GitHub says so', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.telemetry.events.length = 0;
    h.reader.failNext = new GitHubError('GitHub GET notifications failed with 403: API rate limit exceeded', 403, { rateLimited: true, retryAfterSeconds: 60 });

    await expect(h.engine.pollOnce()).rejects.toThrow('rate limit');

    expect(h.telemetry.events).toEqual([{ event: 'rate_limited', props: { source: 'rest', where: 'poll' } }]);
  });
});
