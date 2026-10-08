import type { PrKey } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { GitHubQuota } from './github-quota.ts';
import { COVER_READS_PER_HOUR, NoteCoverReader, type NoteCoverDeps } from './note-cover.ts';

const START = Date.parse('2026-09-02T12:00:00Z');

function setup(overrides: Partial<NoteCoverDeps> = {}) {
  let nowMs = START;
  const quota = new GitHubQuota(() => nowMs);
  const reads: PrKey[] = [];
  const reader = new NoteCoverReader({
    now: () => new Date(nowMs),
    quota,
    pausedReason: () => null,
    read: async (cover) => {
      reads.push(cover);
      return 'stored';
    },
    ...overrides,
  });
  return { reader, quota, reads, later: (ms: number) => (nowMs += ms) };
}

describe('NoteCoverReader', () => {
  it('reads the covering PR and says whether GitHub had it', async () => {
    const { reader, reads } = setup();
    expect(await reader.read('acme/app#77', 'acme/app#1')).toEqual({ kind: 'stored' });
    expect(reads).toEqual(['acme/app#77']);
    const missing = setup({ read: async () => 'not_found' });
    expect(await missing.reader.read('acme/app#404', 'acme/app#1')).toEqual({ kind: 'not_found' });
  });

  it('answers pending when the read is slow, and a retry joins the running read', async () => {
    let finish: (outcome: 'stored') => void = () => {};
    let started = 0;
    const { reader } = setup({
      waitMs: 5,
      read: () => {
        started += 1;
        return new Promise((resolve) => (finish = resolve));
      },
    });
    expect(await reader.read('acme/app#77', 'acme/app#1')).toEqual({ kind: 'pending' });
    const retry = reader.read('acme/app#77', 'acme/app#1');
    finish('stored');
    expect(await retry).toEqual({ kind: 'stored' });
    expect(started).toBe(1);
  });

  it('reads nothing while paused or the quota is nearly used, and turns a failed read into a reason', async () => {
    const paused = setup({ pausedReason: () => 'setup not finished' });
    expect(await paused.reader.read('acme/app#77', 'acme/app#1')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('setup not finished') });
    expect(paused.reads).toEqual([]);

    const critical = setup();
    critical.quota.note({ resource: 'graphql', limit: 5000, remaining: 100, resetAtMs: START + 30 * 60_000 });
    expect(await critical.reader.read('acme/app#77', 'acme/app#1')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('nearly used') });
    expect(critical.reads).toEqual([]);

    const failing = setup({ read: () => Promise.reject(new Error('Bad credentials')) });
    expect(await failing.reader.read('acme/app#77', 'acme/app#1')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('Bad credentials') });
  });

  it('holds the hourly cap across PRs, and frees it an hour later', async () => {
    const { reader, later } = setup();
    for (let number = 1; number <= COVER_READS_PER_HOUR; number++) {
      await reader.read(`acme/app#${number + 100}`, 'acme/app#1');
    }
    expect(await reader.read('acme/app#99', 'acme/app#1')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('in the last hour') });
    later(3600_000);
    expect(await reader.read('acme/app#99', 'acme/app#1')).toEqual({ kind: 'stored' });
  });
});
