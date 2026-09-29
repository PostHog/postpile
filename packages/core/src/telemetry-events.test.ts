import { describe, expect, it } from 'vitest';
import { isTelemetryEventName, RENDERER_TELEMETRY_EVENTS, TELEMETRY_EVENT_NAMES, TELEMETRY_EVENTS } from './telemetry-events.ts';

describe('TELEMETRY_EVENTS', () => {
  it('knows real event names and rejects made-up ones', () => {
    expect(isTelemetryEventName('sync_completed')).toBe(true);
    expect(isTelemetryEventName('made_up_event')).toBe(false);
  });

  it('validates the right shape and rejects extra or missing props (strict schemas)', () => {
    const valid = { tile_kind: 'single', for_whom: 'you', has_glance: true, verdict: 'looks_safe' };
    expect(TELEMETRY_EVENTS.tile_opened.safeParse(valid).success).toBe(true);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, verdict: null }).success).toBe(true);
    const { verdict: _verdict, ...missingVerdict } = valid;
    expect(TELEMETRY_EVENTS.tile_opened.safeParse(missingVerdict).success).toBe(false);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, extra: 'nope' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, tile_kind: 'repo_name' }).success).toBe(false);
  });

  it('has an empty-object schema for events with no props', () => {
    expect(TELEMETRY_EVENTS.app_active.safeParse({}).success).toBe(true);
    expect(TELEMETRY_EVENTS.app_active.safeParse({ anything: 1 }).success).toBe(false);
  });

  it('takes the GitHub quota numbers on sync_completed, with the percentages optional', () => {
    const sync = {
      duration_ms: 1200,
      prs_fetched: 3,
      new_events: 2,
      agent_calls: 1,
      agent_failures: 0,
      cost_usd: 0.02,
      stopped_at_cap: false,
      trigger: 'auto',
      gh_requests: 14,
    };
    expect(TELEMETRY_EVENTS.sync_completed.safeParse(sync).success).toBe(true);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_core_remaining_pct: 97, gh_graphql_remaining_pct: 0 }).success).toBe(true);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_core_remaining_pct: 101 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_graphql_remaining_pct: 12.5 }).success).toBe(false);
  });

  it('knows github_quota_low and where a rate limit hit', () => {
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'graphql', level: 'critical' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'search', level: 'low' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'core', level: 'ok' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.rate_limited.safeParse({ source: 'rest', where: 'poll' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.rate_limited.safeParse({ source: 'rest' }).success).toBe(false);
  });

  it('lists every catalogue key in TELEMETRY_EVENT_NAMES', () => {
    expect(TELEMETRY_EVENT_NAMES).toEqual(Object.keys(TELEMETRY_EVENTS));
  });

  it('only allows a known, deliberate subset of events from the renderer', () => {
    for (const name of RENDERER_TELEMETRY_EVENTS) {
      expect(isTelemetryEventName(name)).toBe(true);
    }
    // The renderer never reports its own sync or agent-trust events: those are the engine's job.
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('sync_completed');
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('memory_corrected');
  });
});
