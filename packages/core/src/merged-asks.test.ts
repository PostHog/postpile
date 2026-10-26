// A merged PR where someone asks the viewer after the merge (2026-10-26,
// owner test after a week away): the ask is still the viewer's move, the
// excerpt shows the asker's own words, and the PR gets a glance.
import { describe, expect, it } from 'vitest';
import { deriveEvents, withoutLeadingQuote } from './events.ts';
import { at, makeComment, makePr, viewer } from './fixtures.ts';
import { prWantsGlance } from './loudness.ts';
import { prTier } from './pr-tier.ts';
import { isPrDone } from './tiles.ts';
import type { FullComment, FullPr, PrEvent } from './types.ts';
import { askAfterMerge, prWhoseTurn } from './whose-turn.ts';

const MERGED_AT = at(100);

const QUESTION = ['> man the bot is really giving you a hard time 😂', '', 'Tried the retry flag, the chart still drops the last point. @viewer any thoughts here?'].join('\n');

function mergedPr(comments: FullComment[]): FullPr {
  return makePr({ repo: 'acme/charts', number: 17, author: 'dana', state: 'MERGED', mergedAt: MERGED_AT, mergedBy: 'bob', comments });
}

const bobAsks = makeComment({ id: 'c-bob', author: 'bob', body: QUESTION, createdAt: at(102) });
const carolReplies = makeComment({ id: 'c-carol', author: 'carol', body: "might have better luck asking in #team-x, he's out", createdAt: at(200) });

function eventsOf(pr: FullPr): PrEvent[] {
  return deriveEvents(pr, viewer, null);
}

describe('a question to you after the merge', () => {
  const pr = mergedPr([bobAsks, carolReplies]);
  const events = eventsOf(pr);

  it('is your move to answer, in Needs reply, and keeps the PR out of done', () => {
    expect(askAfterMerge(pr, events, viewer)?.actor).toBe('bob');
    expect(prWhoseTurn({ pr, events, userState: null, viewer })).toMatchObject({ kind: 'you', move: 'reply', what: "Answer bob's question" });
    expect(prTier({ pr, events, viewer, userState: null, reason: 'mention' })).toBe('needs_reply');
    expect(isPrDone(pr, null, viewer, events)).toBe(false);
    // A glance saying not yours does not hide a direct question.
    expect(isPrDone(pr, null, viewer, events, true)).toBe(false);
  });

  it('ends once you answer', () => {
    const answered = mergedPr([bobAsks, carolReplies, makeComment({ id: 'c-me', author: viewer.login, body: 'Looking now', createdAt: at(300) })]);
    const answeredEvents = eventsOf(answered);
    expect(askAfterMerge(answered, answeredEvents, viewer)).toBeNull();
    expect(prWhoseTurn({ pr: answered, events: answeredEvents, userState: null, viewer }).kind).toBe('none');
    expect(prTier({ pr: answered, events: answeredEvents, viewer, userState: null, reason: 'mention' })).toBe('rest');
    expect(isPrDone(answered, null, viewer, answeredEvents)).toBe(true);
  });

  it('shows the asker’s own words in the excerpt, not the quote', () => {
    const ask = events.find((event) => event.sourceId === 'c-bob');
    expect(ask?.summary).toBe('bob asked you: Tried the retry flag, the chart still drops the last point. @viewer any thoughts here?');
  });
});

describe('asks that stay nobody’s move on a merged PR', () => {
  it('leaves out an ask from before the merge', () => {
    const pr = mergedPr([{ ...bobAsks, createdAt: at(90) }]);
    const events = eventsOf(pr);
    expect(askAfterMerge(pr, events, viewer)).toBeNull();
    expect(prWhoseTurn({ pr, events, userState: null, viewer }).kind).toBe('none');
  });

  it('leaves out bots, team mentions and closed PRs', () => {
    const bot = mergedPr([{ ...bobAsks, author: 'deploy-helper[bot]' }]);
    expect(askAfterMerge(bot, eventsOf(bot), viewer)).toBeNull();
    const team = mergedPr([{ ...bobAsks, body: '@acme/team-platform any thoughts here?' }]);
    expect(askAfterMerge(team, eventsOf(team), viewer)).toBeNull();
    const closed = { ...mergedPr([bobAsks]), state: 'CLOSED' as const, mergedAt: null, mergedBy: null };
    expect(prWhoseTurn({ pr: closed, events: eventsOf(closed), userState: null, viewer }).kind).toBe('none');
  });
});

describe('event excerpts skip a leading quote', () => {
  it('drops leading quoted and blank lines', () => {
    expect(withoutLeadingQuote('> earlier line\n>\n> more\n\nmy own words')).toBe('my own words');
    expect(withoutLeadingQuote('my words\n> a quote later')).toBe('my words\n> a quote later');
  });

  it('keeps a body that is only a quote', () => {
    expect(withoutLeadingQuote('> only a quote')).toBe('> only a quote');
  });
});

describe('glances on merged PRs', () => {
  const merged = { state: 'MERGED' as const };

  it('glances a merged PR whose unread thread names you or your team', () => {
    expect(prWantsGlance(merged, [], { unread: true, reason: 'mention' })).toBe(true);
    expect(prWantsGlance(merged, [], { unread: true, reason: 'team_mention' })).toBe(true);
    expect(prWantsGlance(merged, [], { unread: true, reason: 'assign' })).toBe(true);
  });

  it('leaves out read threads, subscriptions, state changes and closed PRs', () => {
    expect(prWantsGlance(merged, [], { unread: false, reason: 'mention' })).toBe(false);
    expect(prWantsGlance(merged, [], { unread: true, reason: 'subscribed' })).toBe(false);
    expect(prWantsGlance(merged, [], { unread: true, reason: 'state_change' })).toBe(false);
    expect(prWantsGlance(merged, [], null)).toBe(false);
    expect(prWantsGlance({ state: 'CLOSED' }, [], { unread: true, reason: 'mention' })).toBe(false);
    expect(prWantsGlance({ state: 'OPEN' }, [], null)).toBe(true);
  });
});
