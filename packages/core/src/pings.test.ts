import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, viewer } from './fixtures.ts';
import { pingRule, pingTemplate } from './pings.ts';

const pr = makePr({ number: 7, title: 'Move CI to Depot', author: 'alice' });
const ownPr = makePr({ number: 8, author: viewer.login });

describe('pingRule', () => {
  it('never pings for a PR in a quiet repo', () => {
    const mention = makeEvent({ id: 'm', kind: 'mention', actor: 'bob', ruleLoudness: 'loud', ruleReason: 'mentions you' });
    expect(pingRule([mention], pr, viewer, true)).toMatchObject({ class: 'quiet_repo', reason: 'quiet repo (let it go stale)' });
  });

  it('lets a mention through as addressed', () => {
    const mention = makeEvent({ id: 'm', kind: 'mention', actor: 'bob', ruleLoudness: 'loud', ruleReason: 'mentions you' });
    expect(pingRule([mention], pr, viewer, false)).toMatchObject({ class: 'addressed', loudness: 'loud', reason: 'mentions you' });
  });

  it('picks the newest addressed event over older ones and over loud chatter', () => {
    const request = makeEvent({ id: 'r', kind: 'review_requested', ruleLoudness: 'loud', at: at(1) });
    const commits = makeEvent({ id: 'c', kind: 'commits_after_approval', ruleLoudness: 'loud', at: at(5) });
    const comment = makeEvent({ id: 'x', kind: 'comment', ruleLoudness: 'loud', at: at(9) });
    expect(pingRule([request, commits, comment], pr, viewer, false).event?.id).toBe('c');
  });

  it('counts changes requested as addressed only on the viewer’s own PR', () => {
    const changes = makeEvent({ kind: 'review_changes_requested', ruleLoudness: 'loud' });
    expect(pingRule([changes], ownPr, viewer, false).class).toBe('addressed');
    expect(pingRule([changes], pr, viewer, false).class).toBe('not_addressed');
  });

  it('ignores review requests on a merged PR but still hears a question there', () => {
    const merged = makePr({ number: 9, state: 'MERGED' });
    const request = makeEvent({ kind: 'review_requested', ruleLoudness: 'loud' });
    const question = makeEvent({ id: 'q', kind: 'question_to_user', ruleLoudness: 'loud' });
    expect(pingRule([request], merged, viewer, false).class).toBe('not_addressed');
    expect(pingRule([request, question], merged, viewer, false).event?.id).toBe('q');
  });

  it('keeps loud but not addressed events from pinging', () => {
    const approval = makeEvent({ kind: 'review_approved', ruleLoudness: 'loud', ruleReason: 'review on your PR' });
    expect(pingRule([approval], ownPr, viewer, false)).toMatchObject({ class: 'not_addressed', reason: 'review on your PR' });
  });

  it('reads the agent override over the rule loudness', () => {
    const mention = makeEvent({
      kind: 'mention',
      ruleLoudness: 'loud',
      override: { loudness: 'quiet', reason: 'just a thank-you', by: 'agent' },
    });
    expect(pingRule([mention], pr, viewer, false)).toMatchObject({ class: 'quiet', reason: 'just a thank-you' });
  });

  it('classes bot-only activity as bot, whatever it is', () => {
    const bot = makeEvent({ kind: 'bot_comment', actor: 'github-actions', isBot: true, ruleLoudness: 'quiet' });
    const botPush = makeEvent({ id: 'p', kind: 'commits_pushed', isBot: true, ruleLoudness: 'muted' });
    expect(pingRule([bot, botPush], pr, viewer, false).class).toBe('bot');
  });

  it('falls back to quiet, then muted', () => {
    expect(pingRule([makeEvent({ ruleLoudness: 'quiet' })], pr, viewer, false).class).toBe('quiet');
    expect(pingRule([makeEvent({ ruleLoudness: 'muted' })], pr, viewer, false).class).toBe('muted');
    expect(pingRule([], pr, viewer, false).class).toBe('quiet');
  });
});

describe('pingTemplate', () => {
  it('says who did what on which PR', () => {
    const mention = makeEvent({ kind: 'mention', actor: 'bob', summary: 'bob: @viewer can you check the cache?' });
    expect(pingTemplate(mention, pr)).toEqual({
      title: '@bob mentioned you · posthog#7',
      body: 'Move CI to Depot\nbob: @viewer can you check the cache?',
    });
  });

  it('clips long text', () => {
    const long = makeEvent({ kind: 'question_to_user', summary: 'x'.repeat(500) });
    const text = pingTemplate(long, pr);
    expect(text.body.length).toBeLessThanOrEqual(200);
    expect(text.body.endsWith('…')).toBe(true);
  });
});
