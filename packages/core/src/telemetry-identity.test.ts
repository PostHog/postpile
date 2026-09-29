import { describe, expect, it } from 'vitest';
import { hashedTelemetryId, isPostHogMember } from './telemetry-identity.ts';

describe('hashedTelemetryId', () => {
  it('is a stable, deterministic hex hash of the numeric id', () => {
    const first = hashedTelemetryId(12345);
    expect(first).toBe(hashedTelemetryId(12345));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different ids different hashes', () => {
    expect(hashedTelemetryId(1)).not.toBe(hashedTelemetryId(2));
  });

  it('never contains the raw id as a substring (it is a real hash, not an encoding)', () => {
    expect(hashedTelemetryId(424242)).not.toContain('424242');
  });
});

describe('isPostHogMember', () => {
  it('is true for a PostHog team, any case', () => {
    expect(isPostHogMember({ teams: ['PostHog/devex'] })).toBe(true);
    expect(isPostHogMember({ teams: ['posthog/other'] })).toBe(true);
  });

  it('is false without a PostHog team', () => {
    expect(isPostHogMember({ teams: [] })).toBe(false);
    expect(isPostHogMember({ teams: ['acme/infra'] })).toBe(false);
  });
});
