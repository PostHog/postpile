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

  it('offers Retry on a failed glance, with the reason', () => {
    const failed = text({ state: 'failed', gap: { reason: 'failed', detail: 'timeout', at: AT } });
    expect(failed).toMatchObject({ pill: 'Glance failed', retry: true, problem: true });
    expect(failed.card).toContain('(timeout)');
  });

  it('names the limit and when the next full sync comes', () => {
    const daily = text({ state: 'capped', gap: { reason: 'daily_cap', detail: '', at: AT }, nextAutoSyncAt: '2026-09-29T10:41:30.000Z' });
    expect(daily.card).toBe('Waiting: daily agent limit reached, next full sync in 42 min.');
    const syncCap = text({ state: 'capped', gap: { reason: 'call_cap', detail: '', at: AT }, nextAutoSyncAt: null });
    expect(syncCap.card).toBe('Waiting: the last sync hit its agent-call cap, the next sync writes it.');
    expect(text({ state: 'capped', nextAutoSyncAt: '2026-09-29T10:00:20.000Z' }).card).toContain('next full sync in a minute');
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
