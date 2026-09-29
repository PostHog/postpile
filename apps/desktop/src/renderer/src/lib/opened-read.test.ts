import { describe, expect, it } from 'vitest';
import type { TileStateKind, WhoseTurn } from '@postpile/core';
import { OPENED_READ_DELAY_MS, OpenedReadTimer, opensMarkRead, type OpenedReadClock, type OpenedTileView } from './opened-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const ON = { enabled: true, forcedOffReason: null, pending: [] };
const OFF = { enabled: false, forcedOffReason: null, pending: [] };

function view(kind: TileStateKind, done: boolean): OpenedTileView {
  return { state: { kind, unreadBecause: [] }, prs: [{ key: 'acme/app#3', afterRead: { done, turn: NONE } }] };
}

describe('opensMarkRead', () => {
  it('asks when a mark-read of that PR leaves it done and writes are unlocked', () => {
    expect(opensMarkRead(view('unread', true), 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(view('open', true), 'acme/app#3', ON)).toBe(true);
  });

  it('checks the opened PR, not the rest of the set', () => {
    const set: OpenedTileView = {
      state: { kind: 'open', unreadBecause: [] },
      prs: [
        { key: 'acme/app#3', afterRead: { done: true, turn: NONE } },
        { key: 'acme/app#4', afterRead: { done: false, turn: { kind: 'you', move: 'review', who: null, what: 'Review', prKey: 'acme/app#4' } } },
      ],
    };
    expect(opensMarkRead(set, 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(set, 'acme/app#4', ON)).toBe(false);
  });

  it('never asks for a PR that stays your move or a snoozed tile', () => {
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
  function started(wanted = true): { clock: FakeClock; timer: OpenedReadTimer; calls: () => number } {
    const clock = new FakeClock();
    let count = 0;
    const timer = new OpenedReadTimer(() => (count += 1), clock);
    timer.setWanted(wanted);
    return { clock, timer, calls: () => count };
  }

  it('does not mark while the PR is still on screen, only once the user moves on after the delay', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS * 10);
    expect(calls()).toBe(0);

    timer.leave();

    expect(calls()).toBe(1);
  });

  it('marks nothing when the user moves on before the delay', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    timer.leave();
    clock.advance(OPENED_READ_DELAY_MS);
    expect(calls()).toBe(0);
  });

  it('counts leaving the app after the delay as moving on', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    timer.hidden();
    expect(calls()).toBe(1);
  });

  it('marks once per open', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    timer.hidden();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    timer.leave();
    expect(calls()).toBe(1);
  });

  it('starts the wait over when the window comes back after being hidden early, instead of dropping the open', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(1000);
    timer.hidden();
    clock.advance(10_000);
    expect(calls()).toBe(0);

    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    timer.leave();
    expect(calls()).toBe(0);

    const again = started();
    again.timer.visible();
    again.clock.advance(1000);
    again.timer.hidden();
    again.timer.visible();
    again.clock.advance(OPENED_READ_DELAY_MS);
    again.timer.leave();
    expect(again.calls()).toBe(1);
  });

  it('marks nothing on leave when a mark-read is not wanted at that moment', () => {
    const { clock, timer, calls } = started(false);
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    timer.leave();
    expect(calls()).toBe(0);

    const late = started(false);
    late.timer.visible();
    late.clock.advance(OPENED_READ_DELAY_MS);
    // A sync made it wanted while the PR was open: the open still counts.
    late.timer.setWanted(true);
    late.timer.leave();
    expect(late.calls()).toBe(1);
  });
});
