import { describe, expect, it } from 'vitest';
import { QUIET_CATCH_UP_MINUTES, QuietCatchUps } from './quiet-catch-ups.ts';

function clock(start: string) {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    advanceMinutes: (minutes: number) => {
      at += minutes * 60_000;
    },
  };
}

describe('QuietCatchUps', () => {
  it('lets a topic without a recent run through at once', () => {
    const time = clock('2026-10-05T10:00:00Z');
    const quiet = new QuietCatchUps(time.now);
    quiet.add(['depot', null]);
    expect(quiet.due()).toEqual(['depot', null]);
    expect(quiet.due()).toEqual([]);
  });

  it('holds quiet news until the last run is long enough ago, then runs once', () => {
    const time = clock('2026-10-05T10:00:00Z');
    const quiet = new QuietCatchUps(time.now);
    quiet.noteRun('depot');
    quiet.add(['depot']);
    time.advanceMinutes(5);
    quiet.add(['depot']);
    expect(quiet.due()).toEqual([]);

    time.advanceMinutes(QUIET_CATCH_UP_MINUTES - 5);
    expect(quiet.due()).toEqual(['depot']);
    expect(quiet.due()).toEqual([]);
  });

  it('counts a loud run too, and keeps topics apart', () => {
    const time = clock('2026-10-05T10:00:00Z');
    const quiet = new QuietCatchUps(time.now);
    quiet.noteRun('depot');
    quiet.add(['depot', 'billing']);
    expect(quiet.due()).toEqual(['billing']);
  });
});
