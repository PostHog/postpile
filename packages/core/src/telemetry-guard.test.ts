import { describe, expect, it } from 'vitest';
import { sanitizeTelemetryProps } from './telemetry-guard.ts';

describe('sanitizeTelemetryProps', () => {
  it('keeps short, plain props', () => {
    expect(sanitizeTelemetryProps({ tile_kind: 'pr', count: 3, ok: true })).toEqual({ tile_kind: 'pr', count: 3, ok: true });
  });

  it('drops a string longer than 40 characters', () => {
    const dropped: string[] = [];
    const long = 'a'.repeat(41);
    expect(sanitizeTelemetryProps({ note: long }, (key) => dropped.push(key))).toEqual({});
    expect(dropped).toEqual(['note']);
  });

  it('drops a string that looks like a path or a repo name', () => {
    expect(sanitizeTelemetryProps({ repo: 'acme/app' })).toEqual({});
    expect(sanitizeTelemetryProps({ path: '/Users/me/file.ts' })).toEqual({});
  });

  it('drops a string that looks like a PR reference', () => {
    expect(sanitizeTelemetryProps({ title: 'Fix #123' })).toEqual({});
  });

  it('never drops non-string values, however large the number', () => {
    expect(sanitizeTelemetryProps({ count: 1_000_000 })).toEqual({ count: 1_000_000 });
  });

  it('calls onDropped once per dropped key, not per character', () => {
    let calls = 0;
    sanitizeTelemetryProps({ a: 'x'.repeat(100), b: 'ok' }, () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });
});
