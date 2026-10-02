import { describe, expect, it } from 'vitest';
import type { OpenedReadCheck, OpenedReadResult } from '@postpile/core';
import { OPENED_READ_DELAY_MS, OpenedReadTimer, opensMarkRead, type OpenedReadClock, type OpenedReadPhase, type OpenedTileView } from './opened-read.ts';
import { UNDO_WINDOW_MS } from './undo-window.ts';

const ON = { enabled: true, forcedOffReason: null, pending: [] };
const OFF = { enabled: false, forcedOffReason: null, pending: [] };
const MARK: OpenedReadCheck = { kind: 'mark' };

function view(openedRead: OpenedReadCheck): OpenedTileView {
  return { prs: [{ key: 'acme/app#3', openedRead }] };
}

describe('opensMarkRead', () => {
  it('asks when the server would mark or handle the PR and writes are unlocked', () => {
    expect(opensMarkRead(view(MARK), 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(view({ kind: 'handle' }), 'acme/app#3', ON)).toBe(true);
  });

  it('checks the opened PR, not the rest of the set', () => {
    const set: OpenedTileView = {
      prs: [
        { key: 'acme/app#3', openedRead: MARK },
        { key: 'acme/app#4', openedRead: { kind: 'skip', why: 'asks_you' } },
      ],
    };
    expect(opensMarkRead(set, 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(set, 'acme/app#4', ON)).toBe(false);
  });

  it('never promises what the server refuses: your move, snoozed, a stale snapshot', () => {
    expect(opensMarkRead(view({ kind: 'skip', why: 'asks_you' }), 'acme/app#3', ON)).toBe(false);
    expect(opensMarkRead(view({ kind: 'skip', why: 'snoozed' }), 'acme/app#3', ON)).toBe(false);
    expect(opensMarkRead(view({ kind: 'skip', why: 'stale_snapshot' }), 'acme/app#3', ON)).toBe(false);
  });

  it('never asks while locked, before the writes state loaded, or for a PR the tile does not hold', () => {
    expect(opensMarkRead(view(MARK), 'acme/app#3', OFF)).toBe(false);
    expect(opensMarkRead(view(MARK), 'acme/app#3', undefined)).toBe(false);
    expect(opensMarkRead(view(MARK), 'acme/app#9', ON)).toBe(false);
    expect(opensMarkRead(null, 'acme/app#3', ON)).toBe(false);
  });
});

/** Timers that run only when the test moves the time. */
class FakeClock implements OpenedReadClock {
  private time = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.time + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: a fired callback may schedule more timers
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at <= this.time) {
        this.timers.delete(handle);
        timer.callback();
      }
    }
  }
}

/** Lets the server's answer (a resolved promise) reach the timer. */
function answered(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Queued at clock 0 + the dwell, like the engine: the window runs from there. */
const MARKED: OpenedReadResult = { marked: true, undoToken: 'undo-1', undoUntil: new Date(OPENED_READ_DELAY_MS + UNDO_WINDOW_MS).toISOString() };

describe('OpenedReadTimer', () => {
  function started(wanted = true, result: OpenedReadResult | null = MARKED) {
    const clock = new FakeClock();
    const phases: OpenedReadPhase[] = [];
    let count = 0;
    const timer = new OpenedReadTimer(
      () => {
        count += 1;
        return Promise.resolve(result);
      },
      clock,
      (phase) => phases.push(phase),
    );
    timer.setWanted(wanted);
    return { clock, timer, phases, calls: () => count };
  }

  it('marks when the dwell ends, while the PR is still on screen', async () => {
    const { clock, timer, phases, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    expect(calls()).toBe(0);

    clock.advance(1);
    expect(calls()).toBe(1);
    await answered();

    expect(phases).toEqual(['filling', 'sending', 'marked']);
  });

  it('marks nothing when the user moves on before the dwell ends', () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS - 1);
    timer.leave();
    clock.advance(OPENED_READ_DELAY_MS);
    expect(calls()).toBe(0);
  });

  it('marks once per open: hiding and showing the window again asks nothing more', async () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    await answered();
    timer.hidden();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS * 3);
    timer.setWanted(false);
    timer.setWanted(true);
    expect(calls()).toBe(1);
    expect(timer.phase).toBe('marked');
  });

  it('starts the dwell over when the window comes back after being hidden early', () => {
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

  it('drops back to idle when the window hides during the dwell', () => {
    const { clock, timer, phases } = started();
    timer.visible();
    clock.advance(500);
    timer.hidden();
    expect(phases).toEqual(['filling', 'idle']);
  });

  it('waits when a mark is not wanted at the dwell end, and marks once a sync makes it wanted while the PR stays open', () => {
    const { clock, timer, calls } = started(false);
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    expect(calls()).toBe(0);
    expect(timer.phase).toBe('idle');

    timer.setWanted(true);
    expect(calls()).toBe(1);
  });

  it('hands back the token on Undo inside the window, once, and the open stays spent', async () => {
    const { clock, timer, calls } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    await answered();

    expect(timer.undo()).toBe('undo-1');
    expect(timer.phase).toBe('undone');
    expect(timer.undo()).toBeNull();
    timer.hidden();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS * 3);
    expect(calls()).toBe(1);
    expect(timer.phase).toBe('undone');
  });

  it('stops offering Undo when the undo window is over', async () => {
    const { clock, timer } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    await answered();
    clock.advance(UNDO_WINDOW_MS);

    expect(timer.phase).toBe('settled');
    expect(timer.undo()).toBeNull();
  });

  it("ends Undo at the engine's expiry, not a fresh window from when the answer arrived", async () => {
    // The engine queued the mark at the dwell end; the answer took 2s to come back.
    const late: OpenedReadResult = { marked: true, undoToken: 'undo-1', undoUntil: new Date(OPENED_READ_DELAY_MS + UNDO_WINDOW_MS).toISOString() };
    const clock = new FakeClock();
    let answer: (result: OpenedReadResult) => void = () => {};
    const timer = new OpenedReadTimer(() => new Promise((resolve) => (answer = resolve)), clock);
    timer.setWanted(true);
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    clock.advance(2000);
    answer(late);
    await answered();
    expect(timer.phase).toBe('marked');

    clock.advance(UNDO_WINDOW_MS - 2000);

    expect(timer.phase).toBe('settled');
    expect(timer.undo()).toBeNull();
  });

  it('shows nothing marked when the server marked nothing or the request failed', async () => {
    const refused = started(true, { marked: false, undoToken: null, undoUntil: null });
    refused.timer.visible();
    refused.clock.advance(OPENED_READ_DELAY_MS);
    await answered();
    expect(refused.phases).toEqual(['filling', 'sending', 'idle']);

    const failed = started(true, null);
    failed.timer.visible();
    failed.clock.advance(OPENED_READ_DELAY_MS);
    await answered();
    expect(failed.timer.phase).toBe('idle');
  });

  it('ignores an answer that arrives after the user moved on', async () => {
    const { clock, timer, phases } = started();
    timer.visible();
    clock.advance(OPENED_READ_DELAY_MS);
    timer.leave();
    await answered();
    expect(phases).toEqual(['filling', 'sending']);
  });
});
