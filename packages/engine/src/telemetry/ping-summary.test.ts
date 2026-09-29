import type { PingDecision } from '@postpile/core';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { FakeTelemetry } from '../testing/fakes.ts';
import { PING_SUMMARY_META_KEY, PingSummary } from './ping-summary.ts';

const START = new Date('2026-09-02T12:00:00Z');

function minutesLater(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

function decision(minutes: number, ping: boolean, source: PingDecision['source']): PingDecision {
  return { threadId: `t-${minutes}`, prKey: 'acme/app#1', ping, source, title: '', body: '', reason: 'r', at: minutesLater(minutes).toISOString() };
}

function setup() {
  const store = Store.open(':memory:');
  const telemetry = new FakeTelemetry();
  let now = START;
  const summary = new PingSummary(store, telemetry, () => now);
  return {
    store,
    telemetry,
    summary,
    at: (minutes: number) => {
      now = minutesLater(minutes);
    },
  };
}

describe('PingSummary', () => {
  it('starts the clock on the first call without sending the history', () => {
    const s = setup();
    s.store.pingDecisions.add(decision(-30, true, 'agent'));

    s.summary.sendIfDue();

    expect(s.telemetry.events).toEqual([]);
    expect(s.store.meta.get(PING_SUMMARY_META_KEY)).toBe(START.toISOString());
  });

  it('counts pinged, withheld by rules or agent, and quiet mark-reads since the last summary, once per hour', () => {
    const s = setup();
    s.summary.sendIfDue();
    s.store.pingDecisions.add(decision(5, true, 'agent'));
    s.store.pingDecisions.add(decision(6, true, 'fallback'));
    s.store.pingDecisions.add(decision(7, false, 'rules'));
    s.store.pingDecisions.add(decision(8, false, 'agent'));
    const quiet = { action: 'mark_read', origin: 'quiet', threadId: 't', prKey: 'acme/app#2', tileId: null, batch: null, detail: '' } as const;
    s.store.actionLog.add({ ...quiet, outcome: 'github', at: minutesLater(9).toISOString() });
    s.store.actionLog.add({ ...quiet, outcome: 'skipped', at: minutesLater(9).toISOString() });

    s.at(30);
    s.summary.sendIfDue();
    expect(s.telemetry.events).toEqual([]);

    s.at(60);
    s.summary.sendIfDue();
    s.summary.sendIfDue();
    expect(s.telemetry.events).toEqual([
      { event: 'pings_summarized', props: { pinged: 2, withheld_rules: 1, withheld_agent: 1, handled_quietly: 1 } },
    ]);

    s.store.pingDecisions.add(decision(70, false, 'rules'));
    s.at(125);
    s.summary.sendIfDue();
    expect(s.telemetry.events[1]).toEqual({ event: 'pings_summarized', props: { pinged: 0, withheld_rules: 1, withheld_agent: 0, handled_quietly: 0 } });
  });

  it('sends nothing for an hour without decisions or quiet mark-reads, and counts the next hour on its own', () => {
    const s = setup();
    s.summary.sendIfDue();

    s.at(61);
    s.summary.sendIfDue();
    expect(s.telemetry.events).toEqual([]);

    s.store.pingDecisions.add(decision(90, true, 'agent'));
    s.at(122);
    s.summary.sendIfDue();
    expect(s.telemetry.events).toEqual([{ event: 'pings_summarized', props: { pinged: 1, withheld_rules: 0, withheld_agent: 0, handled_quietly: 0 } }]);
  });
});
