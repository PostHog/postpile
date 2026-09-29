import { describe, expect, it } from 'vitest';
import type { TileStateKind, WhoseTurn } from '@postpile/core';
import { OPENED_READ_DELAY_MS, OpenedReadTimer, opensMarkRead, type OpenedReadClock, type OpenedTileView } from './opened-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const ON = { enabled: true, forcedOffReason: null, pending: [] };
const OFF = { enabled: false, forcedOffReason: null, pending: [] };

function view(kind: TileStateKind, done: boolean): OpenedTileView {
  return { state: { kind, unreadBecause: [] }, afterRead: { done, turn: NONE }, prs: [{ key: 'acme/app#3' }] };
}

describe('opensMarkRead', () => {
  it('asks when a mark-read leaves the tile done and writes are unlocked', () => {
    expect(opensMarkRead(view('unread', true), 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(view('open', true), 'acme/app#3', ON)).toBe(true);
  });

  it('never asks for a tile that stays your move or is snoozed', () => {
    expect(opensMarkRead(view('unread', false), 'acme/app#3', ON)).toBe(false);
    expect(opensMarkRead(view('snoozed', true), 'acme/app#3', ON)).toBe(false);
  });

  it('never asks while locked, before the writes state loaded, or for a PR the tile does not hold', () => {
    expect(opensMarkRead(view('unread', true), 'acme/app#3', OFF)).toBe(false);
    expect(opensMarkRead(view('unread', true), 'acme/app#3', undefined)).toBe(false);
    expect(opensMarkRead(view('unread', true), 'acme/app#9', ON)).toBe(false);
    expect(opensMarkRead(null, 'acme/app#3', ON)).toBe(false);
  });
});

/** Timers that run only when the test moves the time. */
class FakeClock implements OpenedReadClock {
  private now = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at <= this.now) {
        this.timers.delete(handle);
        timer.callback();
      }
    }
  }
}

describe('OpenedReadTimer', () => {
  function started(): { clock: FakeClock; timer: OpenedReadTimer; calls: () => number } {
    const clock = new FakeClock();
    let count = 0;
    const timer = new OpenedReadTimer(() => (count += 1), clock);
    return { clock, timer, calls: () => count };
  }

  it('counts the open once, after the delay while visible', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    expect(calls()).toBe(0);
    clock.advance(1);
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    expect(calls()).toBe(1);
  });

  it('starts the wait over when the window comes back after being hidden, instead of dropping the open', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(1000);
    timer.hidden();
    clock.advance(10_000);
    expect(calls()).toBe(0);

    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    expect(calls()).toBe(0);
    clock.advance(1);
    expect(calls()).toBe(1);
  });

  it('never fires after stop, the PR was left before the delay', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    timer.stop();
    clock.advance(OPENED_READ_DELAY_MS);
    expect(calls()).toBe(0);
  });
});
