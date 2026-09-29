import { describe, expect, it } from 'vitest';
import { glanceStateOf, type GlanceStateInput } from './glance-state.ts';

const AT = '2026-09-29T10:00:00.000Z';

function input(overrides: Partial<GlanceStateInput> = {}): GlanceStateInput {
  return { hasGlance: false, stale: false, wanted: true, gap: null, agentOff: false, catchUp: null, ...overrides };
}

describe('glanceStateOf', () => {
  it('is ready with a current glance, whatever else is going on', () => {
    expect(glanceStateOf(input({ hasGlance: true, catchUp: 'running', agentOff: true }))).toBe('ready');
  });

  it('is none for a PR that gets no glance, ready when an old one is left', () => {
    expect(glanceStateOf(input({ wanted: false }))).toBe('none');
    expect(glanceStateOf(input({ wanted: false, hasGlance: true, stale: true }))).toBe('ready');
  });

  it('says writing or queued while a catch-up run covers the topic', () => {
    expect(glanceStateOf(input({ catchUp: 'running' }))).toBe('writing');
    expect(glanceStateOf(input({ catchUp: 'queued', gap: { reason: 'failed', detail: 'x', at: AT } }))).toBe('queued');
    expect(glanceStateOf(input({ hasGlance: true, stale: true, catchUp: 'running' }))).toBe('writing');
  });

  it('keeps a stale glance ready when nothing rewrites it', () => {
    expect(glanceStateOf(input({ hasGlance: true, stale: true, agentOff: true }))).toBe('ready');
  });

  it('names why a glance is missing', () => {
    expect(glanceStateOf(input({ agentOff: true, gap: { reason: 'failed', detail: 'x', at: AT } }))).toBe('agent_off');
    expect(glanceStateOf(input({ gap: { reason: 'failed', detail: 'x', at: AT } }))).toBe('failed');
    expect(glanceStateOf(input({ gap: { reason: 'call_cap', detail: 'x', at: AT } }))).toBe('capped');
    expect(glanceStateOf(input({ gap: { reason: 'daily_cap', detail: 'x', at: AT } }))).toBe('capped');
    expect(glanceStateOf(input())).toBe('queued');
  });
});
