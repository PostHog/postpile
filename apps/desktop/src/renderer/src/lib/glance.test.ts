import { describe, expect, it } from 'vitest';
import { glanceClaim, glanceStateText, type GlanceStateInput } from './glance.ts';

const AT = '2026-09-29T10:00:00.000Z';
const NOW = new Date('2026-09-29T10:00:00.000Z');

function text(overrides: Partial<GlanceStateInput>) {
  return glanceStateText({ state: 'queued', gap: null, nextAutoSyncAt: null, now: NOW, ...overrides });
}

describe('glanceStateText', () => {
  it('says what is happening instead of "the next sync picks it up"', () => {
    expect(text({ state: 'writing' })).toMatchObject({ card: 'Writing the glance…', spinner: true, retry: false });
    expect(text({ state: 'queued' }).pill).toBe('Glance queued');
    expect(text({ state: 'agent_off' }).card).toMatch(/^Agent features are off/);
    expect(text({ state: 'none' }).pill).toBe('No glance');
  });

  // Bug hunt B-A-22: the parser's reason ("left out of the answer") meant nothing in the card.
  it('offers Retry on a failed glance, the parser reason only for the tooltip', () => {
    const failed = text({ state: 'failed', gap: { reason: 'failed', detail: 'left out of the answer', at: AT } });
    expect(failed).toMatchObject({ pill: 'Glance failed', retry: true, problem: true, detail: 'left out of the answer' });
    expect(failed.card).toBe('Glance failed: the agent gave no usable answer for this PR.');
  });

  // Bug hunt UI-A-14: plain words instead of "agent-call cap".
  it('says it was not looked at yet, why, and when the next sync comes', () => {
    const daily = text({ state: 'capped', gap: { reason: 'daily_cap', detail: '', at: AT }, nextAutoSyncAt: '2026-09-29T10:41:30.000Z' });
    expect(daily.pill).toBe('Not looked at yet');
    expect(daily.card).toBe("Not looked at yet: PostPile used up today's agent calls. It reads this one in the next sync, in about 42 min.");
    const syncCap = text({ state: 'capped', gap: { reason: 'call_cap', detail: '', at: AT }, nextAutoSyncAt: null });
    expect(syncCap.card).toBe('Not looked at yet: PostPile ran out of agent calls in the last sync. It reads this one in the next sync.');
    expect(text({ state: 'capped', nextAutoSyncAt: '2026-09-29T10:00:20.000Z' }).card).toContain('in about a minute');
  });
});

describe('glanceClaim', () => {
  it('joins the whole glance into one claim', () => {
    const glance = {
      prKey: 'o/r#1',
      verdict: 'LOOK_CLOSER' as const,
      forYou: 'Changes cache keys.',
      does: 'Moves the cache.',
      risk: 'medium - cold runs',
      othersSaid: '',
      keyFiles: [],
      pullInReason: null,
      dossierVersion: null,
      inputHash: 'h',
      model: 'sonnet',
      createdAt: '2026-09-27T10:00:00.000Z',
    };
    expect(glanceClaim(glance)).toBe('Look closer. Changes cache keys. Does: Moves the cache. Risk: medium - cold runs');
  });
});
