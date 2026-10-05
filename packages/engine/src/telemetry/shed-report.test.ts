import type { HotSelection, PrKey } from '@postpile/core';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { FakeTelemetry } from '../testing/fakes.ts';
import { ShedReport } from './shed-report.ts';

const START = new Date('2026-10-05T12:00:00Z');

function minutesLater(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

const BUSY: HotSelection = {
  keys: new Set(['acme/app#1', 'acme/app#2', 'acme/app#3']),
  inboxPrs: 10,
  busy: true,
  keptByTier: { you: 2, team: 1, others: 0 },
  weakestKept: null,
};

function setup(selection: HotSelection | null) {
  const store = Store.open(':memory:');
  const telemetry = new FakeTelemetry();
  const lines: string[] = [];
  let shed: PrKey[] = [];
  let now = START;
  const source = {
    selection: () => selection,
    takeShed: () => {
      const taken = shed;
      shed = [];
      return taken;
    },
  };
  const report = new ShedReport(store, telemetry, () => now, source, (line) => lines.push(line));
  return {
    telemetry,
    lines,
    report,
    shed: (keys: PrKey[]) => {
      shed = [...shed, ...keys];
    },
    at: (minutes: number) => {
      now = minutesLater(minutes);
    },
  };
}

describe('ShedReport', () => {
  it('says nothing while the inbox is not busy and nothing was left alone', () => {
    const s = setup({ ...BUSY, busy: false, inboxPrs: 3 });

    s.report.sendIfDue();

    expect(s.telemetry.events).toEqual([]);
    expect(s.lines).toEqual([]);
  });

  it('logs and sends what the cap kept and left quiet, at most once an hour', () => {
    const s = setup(BUSY);

    s.report.sendIfDue();
    s.at(59);
    s.report.sendIfDue();
    s.at(60);
    s.report.sendIfDue();

    expect(s.telemetry.events).toEqual([
      { event: 'board_trimmed', props: { kept: 3, dropped: 7 } },
      { event: 'board_trimmed', props: { kept: 3, dropped: 7 } },
    ]);
    expect(s.lines[0]).toBe('board: busy inbox, kept 3 of 10 hot PRs (you 2, team 1, others 0), 7 left quiet');
  });

  it('counts the PRs the fetch left alone over the hour, each once, and starts over after a report', () => {
    const s = setup(null);

    s.shed(['acme/app#7', 'acme/app#8']);
    s.report.sendIfDue();
    s.shed(['acme/app#9']);
    s.at(30);
    s.report.sendIfDue();
    s.at(61);
    s.report.sendIfDue();

    expect(s.telemetry.events).toEqual([
      { event: 'work_shed', props: { skipped_prs: 2 } },
      { event: 'work_shed', props: { skipped_prs: 1 } },
    ]);
  });
});
