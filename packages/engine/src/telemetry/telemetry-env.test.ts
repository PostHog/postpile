import { describe, expect, it } from 'vitest';
import { telemetryEnabled } from './telemetry-env.ts';

describe('telemetryEnabled', () => {
  it('is on by default', () => {
    expect(telemetryEnabled({})).toBe(true);
  });

  it('is off under vitest, whatever else is set', () => {
    expect(telemetryEnabled({ VITEST: 'true' })).toBe(false);
    expect(telemetryEnabled({ VITEST: 'true', POSTPILE_TELEMETRY: '1' })).toBe(false);
  });

  it('is off for POSTPILE_TELEMETRY=0, DO_NOT_TRACK=1, fake mode and the dev profile', () => {
    expect(telemetryEnabled({ POSTPILE_TELEMETRY: '0' })).toBe(false);
    expect(telemetryEnabled({ DO_NOT_TRACK: '1' })).toBe(false);
    expect(telemetryEnabled({ POSTPILE_FAKE: '1' })).toBe(false);
    expect(telemetryEnabled({ POSTPILE_PROFILE: 'dev' })).toBe(false);
  });

  it('POSTPILE_TELEMETRY=1 forces it on in dev, for checking by hand', () => {
    expect(telemetryEnabled({ POSTPILE_PROFILE: 'dev', POSTPILE_TELEMETRY: '1' })).toBe(true);
    expect(telemetryEnabled({ POSTPILE_FAKE: '1', POSTPILE_TELEMETRY: '1' })).toBe(true);
  });
});
