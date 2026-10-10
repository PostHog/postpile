import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrKey, PrNoteResult } from '@postpile/core';
import { FakeEngine, type FakeEngineOptions } from './fake-engine.ts';
import { FAKE_COVER_WAIT_MS, SLOW_COVER_NUMBER } from './fake-note-cover.ts';

const NOTED = 'acme/app#1904';

function engine(options: FakeEngineOptions = {}): FakeEngine {
  return new FakeEngine({ setupStepMs: 0, syncStepMs: 0, ...options });
}

async function coverNote(fake: FakeEngine, coveredBy: PrKey): Promise<PrNoteResult> {
  const token = (await fake.getPr(NOTED))?.notes.token ?? '';
  return fake.notePr(
    { action: 'set', prKey: NOTED, kind: 'covered', note: 'Reviewed with the parent', by: 'test session', token, coveredByPrKey: coveredBy, coverToken: null, leaseMinutes: null },
    { client: 'claude-code' },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('note_pr covered_by a PR outside the sample', () => {
  it('reads #1000 to #1999 from "GitHub" once and keeps it as a pulled-in PR, no tile and no topic', async () => {
    const fake = engine();
    const result = await coverNote(fake, 'acme/app#1700');
    expect(result).toMatchObject({ status: 'set', note: { coveredBy: 'acme/app#1700' } });

    const cover = await fake.getPr('acme/app#1700');
    expect(cover?.topicId).toBeNull();
    expect(cover?.tileIds).toEqual([]);
  });

  it('answers "GitHub has no PR" from #90000 up', async () => {
    const result = await coverNote(engine(), 'acme/app#95000');
    expect(result.status).toBe('refused');
    expect(result.reason).toBe('GitHub has no PR acme/app#95000 that PostPile can read; check covered_by');
  });

  it('still refuses any other PR outside the sample', async () => {
    const result = await coverNote(engine(), 'acme/app#4242');
    expect(result.status).toBe('refused');
    expect(result.reason).toBe('the sample data has no PR acme/app#4242, and the sample-data engine reads nothing from GitHub');
    // #1915 is acme/infra's in the sample, so acme/app#1915 is no PR the stand-in knows.
    expect((await coverNote(engine(), 'acme/app#1915')).reason).toContain('the sample data has no PR acme/app#1915');
  });

  it('answers pending once for the slow number, and a retry finds it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = engine();
    const cover = `acme/app#${SLOW_COVER_NUMBER}`;
    const first = coverNote(fake, cover);
    await vi.advanceTimersByTimeAsync(FAKE_COVER_WAIT_MS);
    expect(await first).toMatchObject({ status: 'pending' });

    await vi.advanceTimersByTimeAsync(5000);
    expect(await coverNote(fake, cover)).toMatchObject({ status: 'set', note: { coveredBy: cover } });
  });

  it('reads nothing while the GitHub quota is nearly used', async () => {
    const result = await coverNote(engine({ quota: 'critical' }), 'acme/app#1700');
    expect(result.status).toBe('refused');
    expect(result.reason).toContain("The user's GitHub quota is nearly used");
  });
});
