import { describe, expect, it } from 'vitest';
import { PhaseClock, phaseTimingsText } from './phase-clock.ts';

describe('PhaseClock', () => {
  it('times overlapping phases on their own and lists the running ones', async () => {
    let ms = 0;
    const clock = new PhaseClock(() => new Date(ms));
    let finishDossiers = () => {};
    const dossiers = clock.time('dossiers', () => new Promise<void>((resolve) => (finishDossiers = resolve)));
    ms = 1000;
    await clock.time('sets', async () => {
      ms = 3000;
    });
    expect(clock.running()).toEqual(['dossiers']);
    ms = 5000;
    finishDossiers();
    await dossiers;

    expect(clock.timings()).toEqual({ dossiers: 5000, sets: 2000 });
    expect(clock.running()).toEqual([]);
  });

  it('keeps the timing of a phase that threw', async () => {
    let ms = 0;
    const clock = new PhaseClock(() => new Date(ms));
    await expect(
      clock.time('fetch', async () => {
        ms = 1500;
        throw new Error('GitHub down');
      }),
    ).rejects.toThrow('GitHub down');
    expect(clock.timings()).toEqual({ fetch: 1500 });
  });
});

describe('phaseTimingsText', () => {
  it('lists phases in sync order with seconds', () => {
    expect(phaseTimingsText({ glances: 95_000, fetch: 12_340, topics: 8_000 })).toBe('fetch 12.3s, topics 8.0s, glances 95.0s');
    expect(phaseTimingsText({})).toBe('');
  });
});
