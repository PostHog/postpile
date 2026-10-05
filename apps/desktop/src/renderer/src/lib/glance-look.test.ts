import { describe, expect, it } from 'vitest';
import { GLANCE_LOOK_DELAY_MS, GlanceLookTimer, wantsGlanceRefresh, type GlanceLookClock } from './glance-look.ts';

/** A clock the test moves by hand. */
class FakeClock implements GlanceLookClock {
  private now = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.next++;
    this.timers.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [handle, timer] of this.timers) {
      if (timer.at <= this.now) {
        this.timers.delete(handle);
        timer.callback();
      }
    }
  }
}

function openTimer(wanted = true): { timer: GlanceLookTimer; clock: FakeClock; fired: () => number } {
  const clock = new FakeClock();
  let count = 0;
  const timer = new GlanceLookTimer(() => {
    count += 1;
  }, clock);
  timer.setWanted(wanted);
  timer.visible();
  return { timer, clock, fired: () => count };
}

describe('wantsGlanceRefresh', () => {
  it('asks only for a stale glance the server can refresh and nobody writes yet', () => {
    const stale = { glanceStale: true, glanceBehindDossier: false, glanceRefreshBlock: null, glanceState: 'ready' as const };
    expect(wantsGlanceRefresh(stale)).toBe(true);
    expect(wantsGlanceRefresh({ ...stale, glanceStale: false })).toBe(false);
    expect(wantsGlanceRefresh({ ...stale, glanceRefreshBlock: 'daily_cap' })).toBe(false);
    expect(wantsGlanceRefresh({ ...stale, glanceState: 'writing' })).toBe(false);
    expect(wantsGlanceRefresh({ ...stale, glanceState: 'queued' })).toBe(false);
    expect(wantsGlanceRefresh(null)).toBe(false);
  });

  it('also asks for a current glance written against an older dossier', () => {
    const behind = { glanceStale: false, glanceBehindDossier: true, glanceRefreshBlock: null, glanceState: 'ready' as const };
    expect(wantsGlanceRefresh(behind)).toBe(true);
    expect(wantsGlanceRefresh({ ...behind, glanceRefreshBlock: 'daily_cap' })).toBe(false);
  });
});

describe('GlanceLookTimer', () => {
  it('fires after the dwell, not under it', () => {
    const { clock, fired } = openTimer();
    clock.advance(GLANCE_LOOK_DELAY_MS - 1);
    expect(fired()).toBe(0);
    clock.advance(1);
    expect(fired()).toBe(1);
  });

  it('fires nothing when the user moves on before the dwell', () => {
    const { timer, clock, fired } = openTimer();
    clock.advance(GLANCE_LOOK_DELAY_MS / 2);
    timer.leave();
    clock.advance(GLANCE_LOOK_DELAY_MS);
    expect(fired()).toBe(0);
  });

  it('fires once per open, also when the glance turns stale again later', () => {
    const { timer, clock, fired } = openTimer();
    clock.advance(GLANCE_LOOK_DELAY_MS);
    timer.setWanted(false);
    timer.setWanted(true);
    timer.hidden();
    timer.visible();
    clock.advance(GLANCE_LOOK_DELAY_MS);
    expect(fired()).toBe(1);
  });

  it('fires when the glance turns stale after the dwell, while the PR is still open', () => {
    const { timer, clock, fired } = openTimer(false);
    clock.advance(GLANCE_LOOK_DELAY_MS);
    expect(fired()).toBe(0);
    timer.setWanted(true);
    expect(fired()).toBe(1);
  });

  it('starts the dwell over when the window was hidden before it ended', () => {
    const { timer, clock, fired } = openTimer();
    clock.advance(GLANCE_LOOK_DELAY_MS - 100);
    timer.hidden();
    timer.visible();
    clock.advance(GLANCE_LOOK_DELAY_MS - 1);
    expect(fired()).toBe(0);
    clock.advance(1);
    expect(fired()).toBe(1);
  });
});
