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
