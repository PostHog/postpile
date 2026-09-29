import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeEvent, makePr, makeTimelineItem, viewer } from './fixtures.ts';
import { lookCloserEvent } from './glance-pings.ts';
import { breaksSnooze, isSnoozeOver, snoozeTelemetryBucket, type SnoozeContext } from './snooze.ts';
import type { Snooze, SnoozeCondition } from './types.ts';

function snooze(condition: SnoozeCondition): Snooze {
  return { tileId: 'pr:acme/app#1', condition, since: at(10) };
}

function context(overrides: Partial<SnoozeContext> = {}): SnoozeContext {
  return { prs: [makePr()], events: [], now: at(20), viewer, ...overrides };
}

describe('isSnoozeOver', () => {
  it('until_time ends when the time has come', () => {
    const until = snooze({ kind: 'until_time', until: at(30) });
    expect(isSnoozeOver(until, context({ now: at(29) }))).toBe(false);
    expect(isSnoozeOver(until, context({ now: at(30) }))).toBe(true);
  });

  it('someone_replies ends on a human reply after the snooze, not a bot or the viewer', () => {
    const replies = snooze({ kind: 'someone_replies' });
    const before = makeEvent({ kind: 'comment', at: at(5) });
    const bot = makeEvent({ kind: 'bot_comment', actor: 'vercel', isBot: true, at: at(15) });
    const own = makeEvent({ kind: 'comment', actor: 'viewer', at: at(15) });
    expect(isSnoozeOver(replies, context({ events: [before, bot, own] }))).toBe(false);
    const human = makeEvent({ kind: 'review_commented', actor: 'alice', at: at(15) });
    expect(isSnoozeOver(replies, context({ events: [human] }))).toBe(true);
  });

  it('new_push ends on commits or a force push after the snooze', () => {
    const push = snooze({ kind: 'new_push' });
    expect(isSnoozeOver(push, context({ events: [makeEvent({ kind: 'commits_pushed', at: at(5) })] }))).toBe(false);
    expect(isSnoozeOver(push, context({ events: [makeEvent({ kind: 'force_pushed', at: at(11) })] }))).toBe(true);
  });

  it('ci_green ends when every open PR in the tile is green', () => {
    const green = snooze({ kind: 'ci_green' });
    const ok = makePr({ number: 1, checks: { rollup: 'SUCCESS', contexts: [] } });
    const failing = makePr({ number: 2, checks: { rollup: 'FAILURE', contexts: [] } });
    const merged = makePr({ number: 3, state: 'MERGED', checks: { rollup: 'FAILURE', contexts: [] } });
    expect(isSnoozeOver(green, context({ prs: [ok, failing] }))).toBe(false);
    expect(isSnoozeOver(green, context({ prs: [ok, merged] }))).toBe(true);
    expect(isSnoozeOver(green, context({ prs: [] }))).toBe(false);
  });
});

describe('breaksSnooze', () => {
  it('lets an unseen loud human event after the snooze through', () => {
    const s = snooze({ kind: 'until_time', until: at(999) });
    expect(breaksSnooze(makeEvent({ ruleLoudness: 'loud', at: at(11) }), s, context())).toBe(true);
    expect(breaksSnooze(makeEvent({ ruleLoudness: 'loud', at: at(9) }), s, context())).toBe(false);
    expect(breaksSnooze(makeEvent({ ruleLoudness: 'quiet', at: at(11) }), s, context())).toBe(false);
    expect(breaksSnooze(makeEvent({ ruleLoudness: 'loud', isBot: true, at: at(11) }), s, context())).toBe(false);
    expect(breaksSnooze(makeEvent({ ruleLoudness: 'loud', seenAt: at(12), at: at(11) }), s, context())).toBe(false);
  });

  it('wakes on a bot-made review request that asks the viewer, never on the app-made Look closer event', () => {
    const s = snooze({ kind: 'until_time', until: at(999) });
    const request = makeTimelineItem({ id: 'rr', actor: 'assignbot[bot]', subject: viewer.login, at: at(15) });
    const pr = makePr({ author: 'rowan', reviewerUsers: [viewer.login], timeline: [request] });
    const event = deriveEvents(pr, viewer, null).find((candidate) => candidate.kind === 'review_requested')!;
    expect(event).toMatchObject({ isBot: true, ruleLoudness: 'loud' });
    expect(breaksSnooze(event, s, context({ prs: [pr] }))).toBe(true);
    const lookCloser = lookCloserEvent(pr, 'acme/team-platform', 'rr', at(16));
    expect(breaksSnooze(lookCloser, s, context({ prs: [pr] }))).toBe(false);
  });
});

describe('snoozeTelemetryBucket', () => {
  const nowMs = new Date('2026-01-01T00:00:00.000Z').getTime();

  it('names the condition directly for an event-based snooze', () => {
    expect(snoozeTelemetryBucket({ kind: 'someone_replies' }, nowMs)).toBe('someone_replies');
    expect(snoozeTelemetryBucket({ kind: 'new_push' }, nowMs)).toBe('new_push');
    expect(snoozeTelemetryBucket({ kind: 'ci_green' }, nowMs)).toBe('ci_green');
  });

  it('buckets a time-based snooze by how far out it is', () => {
    const hoursAway = (hours: number) => new Date(nowMs + hours * 3_600_000).toISOString();
    expect(snoozeTelemetryBucket({ kind: 'until_time', until: hoursAway(2) }, nowMs)).toBe('hours');
    expect(snoozeTelemetryBucket({ kind: 'until_time', until: hoursAway(20) }, nowMs)).toBe('a_day');
    expect(snoozeTelemetryBucket({ kind: 'until_time', until: hoursAway(72) }, nowMs)).toBe('days');
    expect(snoozeTelemetryBucket({ kind: 'until_time', until: hoursAway(24 * 10) }, nowMs)).toBe('a_week');
  });
});
