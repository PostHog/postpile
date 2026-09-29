import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeThreadFor, makeTimelineItem, viewer } from './fixtures.ts';
import { botNames, botOnlySinceRead, botsFromQuietDetail, quietReadCheck, quietReadDetail, type QuietReadInput } from './quiet-reads.ts';
import type { PrEvent } from './types.ts';

const pr = makePr({ number: 7, author: 'alice' });

function botComment(minute: number, actor = 'trunk-io[bot]'): PrEvent {
  return makeEvent({ id: `bot-${minute}`, prKey: pr.key, kind: 'bot_comment', actor, isBot: true, at: at(minute), summary: `${actor} commented` });
}

function ciResult(minute: number): PrEvent {
  return makeEvent({ id: `ci-${minute}`, prKey: pr.key, kind: 'ci', actor: '', isBot: true, at: at(minute), summary: 'CI passed' });
}

function humanComment(minute: number): PrEvent {
  return makeEvent({ id: `human-${minute}`, prKey: pr.key, kind: 'comment', actor: 'alice', isBot: false, at: at(minute) });
}

function input(overrides: Partial<QuietReadInput> = {}): QuietReadInput {
  return {
    thread: makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(31), unread: true, reason: 'subscribed' }),
    pr,
    events: [humanComment(5), botComment(30), ciResult(31)],
    userState: null,
    viewer,
    tileUnread: false,
    notYours: false,
    prFetchedAt: at(50),
    now: at(60),
    ...overrides,
  };
}

describe('botOnlySinceRead', () => {
  it('returns the events after the read when every one is a bot, CI results without an actor included', () => {
    const events = [humanComment(5), botComment(30), ciResult(31)];
    expect(botOnlySinceRead(events, at(20))?.map((event) => event.id)).toEqual(['bot-30', 'ci-31']);
  });

  it('is null once a person took part after the read', () => {
    expect(botOnlySinceRead([botComment(30), humanComment(32)], at(20))).toBeNull();
  });

  it('is null when nothing known happened after the read', () => {
    expect(botOnlySinceRead([humanComment(5)], at(20))).toBeNull();
  });

  it('counts an actor-less event as a bot even when it was not flagged', () => {
    const deploy = makeEvent({ id: 'deploy', kind: 'deploy', actor: '', isBot: false, at: at(30) });
    expect(botOnlySinceRead([deploy], at(20))).toHaveLength(1);
  });
});

describe('botNames', () => {
  it('lists each bot once, CI for actor-less events', () => {
    expect(botNames([botComment(30), ciResult(31), botComment(32)])).toEqual(['trunk-io[bot]', 'CI']);
  });
});

describe('quietReadCheck', () => {
  it('marks a read thread that turned unread only because of bots, naming them', () => {
    expect(quietReadCheck(input())).toEqual({ kind: 'mark', bots: ['trunk-io[bot]', 'CI'] });
  });

  it('leaves threads alone that GitHub has read or the user never read', () => {
    expect(quietReadCheck(input({ thread: makeThreadFor(pr, { lastReadAt: at(20), unread: false }) }))).toEqual({ kind: 'skip', why: 'not_unread' });
    expect(quietReadCheck(input({ thread: makeThreadFor(pr, { lastReadAt: null, updatedAt: at(31) }) }))).toEqual({ kind: 'skip', why: 'never_read' });
  });

  it('leaves it when the PR snapshot is older than the thread or unknown', () => {
    expect(quietReadCheck(input({ prFetchedAt: null }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    // The thread moved at 31, the snapshot is from 30: a comment after it would be missing from the events.
    expect(quietReadCheck(input({ prFetchedAt: at(30) }))).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    expect(quietReadCheck(input({ prFetchedAt: at(31) })).kind).toBe('mark');
  });

  it('leaves it when a person did something since the last read', () => {
    expect(quietReadCheck(input({ events: [botComment(30), humanComment(33)] }))).toEqual({ kind: 'skip', why: 'human_activity' });
  });

  it('never marks the user own PR: bot reviews there can mean work', () => {
    const own = { ...pr, author: viewer.login };
    expect(quietReadCheck(input({ pr: own }))).toEqual({ kind: 'skip', why: 'own_pr' });
  });

  it('never marks a PR with an unseen merge without the user review, even when a bot merged it', () => {
    const merged = { ...pr, state: 'MERGED' as const, mergedAt: at(30) };
    const merge = makeEvent({ id: 'merge', prKey: pr.key, kind: 'merged_without_review', actor: 'trunk-io[bot]', isBot: true, at: at(30), ruleLoudness: 'quiet' });
    expect(quietReadCheck(input({ pr: merged, events: [merge] }))).toEqual({ kind: 'skip', why: 'unseen_merge' });
  });

  it('leaves it while the tile is unread', () => {
    expect(quietReadCheck(input({ tileUnread: true }))).toEqual({ kind: 'skip', why: 'tile_unread' });
  });

  it('leaves it while it is the user move', () => {
    const asked = makePr({ number: 7, author: 'alice', reviewerUsers: [viewer.login], timeline: [makeTimelineItem({ actor: 'alice', subject: viewer.login, at: at(1) })] });
    expect(quietReadCheck(input({ pr: asked }))).toEqual({ kind: 'skip', why: 'your_move' });
  });

  it('waits the grace period after the newest bot activity or thread update', () => {
    expect(quietReadCheck(input({ now: at(40) }))).toEqual({ kind: 'skip', why: 'grace' });
    const lateThread = makeThreadFor(pr, { lastReadAt: at(20), updatedAt: at(55), unread: true });
    expect(quietReadCheck(input({ thread: lateThread, prFetchedAt: at(56) }))).toEqual({ kind: 'skip', why: 'grace' });
    expect(quietReadCheck(input({ now: at(41) })).kind).toBe('mark');
  });
});

describe('quiet read detail', () => {
  it('round-trips the bot names through the action log detail', () => {
    const detail = quietReadDetail(['trunk-io[bot]', 'CI']);
    expect(detail).toBe('only bot activity since your last read: trunk-io[bot], CI');
    expect(botsFromQuietDetail(detail)).toEqual(['trunk-io[bot]', 'CI']);
    expect(botsFromQuietDetail('already read on GitHub')).toEqual([]);
  });
});
