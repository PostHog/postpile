import { describe, expect, it } from 'vitest';
import { updateCheck, type UpdateSignals } from './update-check.ts';

function check(overrides: Partial<UpdateSignals> = {}) {
  return updateCheck({ ownVersion: '0.13.1', expectedSchema: 12, databaseSchema: async () => 12, appVersion: () => '0.13.1', ...overrides });
}

describe('updateCheck', () => {
  it('flags a database with another schema than this build expects', async () => {
    expect(await check()()).toBe(false);
    expect(await check({ databaseSchema: async () => 13 })()).toBe(true);
  });

  it('flags a running app with another version', async () => {
    expect(await check({ appVersion: () => '0.14.0' })()).toBe(true);
  });

  it('does not flag a version it does not know on both sides', async () => {
    expect(await check({ appVersion: () => null })()).toBe(false);
    expect(await check({ appVersion: () => 'unknown' })()).toBe(false);
    expect(await check({ ownVersion: 'unknown', appVersion: () => '0.14.0' })()).toBe(false);
    expect(await check({ databaseSchema: async () => null })()).toBe(false);
  });

  it('looks again on every call, and keeps a mismatch for good', async () => {
    let schema = 12;
    const updated = check({ databaseSchema: async () => schema });
    expect(await updated()).toBe(false);
    schema = 13;
    expect(await updated()).toBe(true);
    schema = 12;
    expect(await updated()).toBe(true);
  });
});
