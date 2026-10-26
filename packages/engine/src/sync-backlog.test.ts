import { describe, expect, it } from 'vitest';
import { BACKLOG_SYNC_MINUTES } from './auto-sync.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const MINUTE = 60_000;

/** Two topics with a PR each: more agent work than one call. */
function twoTopics(): Harness {
  const h = makeHarness();
  topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
  topicWithPrs(h, 'billing', [reviewRequestedPr(2, { repo: 'acme/web' })]);
  h.engine.startAutoSync({ minutes: 60, maxAgentCalls: 150 });
  return h;
}

async function minutesToNextAutoSync(h: Harness): Promise<number> {
  const next = (await h.engine.livePollStatus()).nextAutoSyncAt;
  return next === null ? Number.NaN : (new Date(next).getTime() - h.timers.now()) / MINUTE;
}

describe('next background sync after the agent-call cap', () => {
  it('comes after BACKLOG_SYNC_MINUTES when the cap skipped agent work', async () => {
    const h = twoTopics();

    const report = await h.engine.sync({ maxAgentCalls: 1 });

    expect(report.agentCalls).toBe(1);
    expect(Object.values(report.agentCallStats.byKind).some((count) => (count?.skippedByBudget ?? 0) > 0)).toBe(true);
    expect(await minutesToNextAutoSync(h)).toBe(BACKLOG_SYNC_MINUTES);
    h.engine.stopAutoSync();
  });

  it('waits the full interval when nothing was skipped, or when the cap allows no call at all', async () => {
    const roomy = twoTopics();
    await roomy.engine.sync({ maxAgentCalls: 150 });
    const none = twoTopics();
    await none.engine.sync({ maxAgentCalls: 0 });

    expect([await minutesToNextAutoSync(roomy), await minutesToNextAutoSync(none)]).toEqual([60, 60]);
    roomy.engine.stopAutoSync();
    none.engine.stopAutoSync();
  });
});
