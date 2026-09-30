import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeEvent, makePr, makeTimelineItem, viewer } from './fixtures.ts';
import { pingRule, pingTemplate } from './pings.ts';
import type { EventKind, Loudness, Pr, Viewer } from './types.ts';
import { prWhoseTurn } from './whose-turn.ts';

const pr = makePr({ number: 7, title: 'Move CI to Depot', author: 'alice' });
const ownPr = makePr({ number: 8, author: viewer.login });

describe('pingRule', () => {
  it('never pings for a PR in a quiet repo', () => {
    const mention = makeEvent({ id: 'm', kind: 'mention', actor: 'bob', ruleLoudness: 'loud', ruleReason: 'mentions you' });
    expect(pingRule([mention], pr, viewer, true)).toMatchObject({ class: 'quiet_repo', reason: 'quiet repo (let it go stale)' });
  });

  it('never pings for a PR whose tile is still snoozed', () => {
    // The raised event wakes a real snooze first (`breaksSnooze`); a tile still snoozed never pings.
    const raised = makeEvent({ id: 'r', kind: 'review_requested', actor: 'github-actions[bot]', isBot: true, ruleLoudness: 'quiet', override: { loudness: 'loud', reason: 'worth a look', by: 'agent' } });
    const comment = makeEvent({ id: 'c', kind: 'comment', actor: 'ada', ruleLoudness: 'quiet', at: at(11) });
    expect(pingRule([raised, comment], pr, viewer, false)).toMatchObject({ class: 'addressed', event: { id: 'r' } });
    expect(pingRule([raised, comment], pr, viewer, false, true)).toMatchObject({ class: 'snoozed', reason: 'tile snoozed' });
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

  it('pings for a team review request on a teammate\'s PR like a personal one', () => {
    const withTeam = { ...viewer, teamMembers: ['lyra'] };
    const byTeammate = makePr({ number: 10, author: 'lyra', reviewerTeams: ['acme/team-platform'] });
    const request = makeEvent({ kind: 'review_requested', actor: 'lyra', ruleLoudness: 'loud', ruleReason: 'review requested from you' });
    expect(pingRule([request], byTeammate, withTeam, false)).toMatchObject({ class: 'addressed', event: { id: request.id } });
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

  it('never pings for CI, not even a failure on the viewer own PR', () => {
    const ci = makeEvent({ id: 'ci', kind: 'ci', actor: '', isBot: true, summary: 'CI failed: test', ruleLoudness: 'quiet', ruleReason: 'bot activity' });
    expect(pingRule([ci], ownPr, viewer, false)).toMatchObject({ class: 'bot', loudness: 'quiet' });
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
      title: '@bob mentioned you · app#7',
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

describe('pingRule on drafts', () => {
  const draft = makePr({ number: 9, author: 'alice', isDraft: true });

  it('pings a draft only for a personal question or mention', () => {
    const request = makeEvent({ kind: 'review_requested', ruleLoudness: 'loud' });
    const team = makeEvent({ id: 't', kind: 'team_mention', ruleLoudness: 'loud' });
    const mention = makeEvent({ id: 'm', kind: 'mention', ruleLoudness: 'loud' });
    expect(pingRule([request], draft, viewer, false).class).toBe('not_addressed');
    expect(pingRule([team], draft, viewer, false).class).toBe('not_addressed');
    expect(pingRule([mention], draft, viewer, false).class).toBe('addressed');
  });
});

describe('a review request counts by whom it asks, not who clicked it', () => {
  const withTeam = { ...viewer, teamMembers: ['lyra'] };
  const request = (subject: string) => makeTimelineItem({ id: `rr-${subject}`, actor: 'assignbot[bot]', subject, at: at(20) });

  function requestEvent(pr: Pr, who: Viewer = withTeam) {
    const event = deriveEvents(pr, who, null).find((candidate) => candidate.kind === 'review_requested');
    if (!event) {
      throw new Error('no review request event');
    }
    return event;
  }

  it('makes a bot-made team request on a teammate PR loud and addressed, and names no bot in the ping', () => {
    const pr = makePr({ number: 21, author: 'lyra', reviewerTeams: ['acme/team-platform'], timeline: [request('acme/team-platform')] });
    const event = requestEvent(pr);
    expect(event).toMatchObject({ isBot: true, ruleLoudness: 'loud', ruleReason: 'review requested from you' });
    expect(pingRule([event], pr, withTeam, false)).toMatchObject({ class: 'addressed', event: { id: event.id } });
    expect(pingTemplate(event, pr).title).toBe('Review requested for team-platform · app#21');
  });

  it('sends a bot-made routed team request the way a human-made one goes: no poll ping, the glance decides', () => {
    const pr = makePr({ number: 22, author: 'rowan', reviewerTeams: ['acme/team-platform'], timeline: [request('acme/team-platform')] });
    const event = requestEvent(pr);
    expect(event.ruleLoudness).toBe('loud');
    expect(pingRule([event], pr, withTeam, false).class).toBe('routed');
    const human = { ...event, actor: 'rowan', isBot: false };
    expect(pingRule([human], pr, withTeam, false).class).toBe('routed');
  });

  it('keeps a bot-made request to another team quiet bot activity', () => {
    const pr = makePr({ number: 23, author: 'rowan', reviewerTeams: ['acme/team-web'], timeline: [request('acme/team-web')] });
    const event = requestEvent(pr);
    expect(event).toMatchObject({ ruleLoudness: 'quiet', ruleReason: 'bot activity' });
    expect(pingRule([event], pr, withTeam, false).class).toBe('bot');
  });

  it('keeps a personal bot request loud, and whose turn does not name the bot', () => {
    const pr = makePr({ number: 24, author: 'rowan', reviewerUsers: [viewer.login], timeline: [request(viewer.login)] });
    expect(requestEvent(pr).ruleLoudness).toBe('loud');
    expect(prWhoseTurn({ pr, events: [], userState: null, viewer: withTeam })).toMatchObject({ kind: 'you', what: 'Review' });
    const teamPr = makePr({ number: 25, author: 'lyra', reviewerTeams: ['acme/team-platform'], timeline: [request('acme/team-platform')] });
    expect(prWhoseTurn({ pr: teamPr, events: [], userState: null, viewer: withTeam })).toMatchObject({ what: "Review for team-platform: lyra's PR" });
  });
});

describe('ping table', () => {
  it('has a row for every mix of loudness, kind, PR state and quiet repo', () => {
    const kinds: EventKind[] = ['mention', 'review_requested', 'comment', 'ci', 'commits_after_approval'];
    const loudnesses: Loudness[] = ['loud', 'quiet', 'muted'];
    const prs = [pr, ownPr, makePr({ isDraft: true }), makePr({ state: 'MERGED' })];
    for (const target of prs) {
      // pingRule throws when no row matches.
      expect(pingRule([], target, viewer, false).class).toBe('quiet');
      for (const quietRepo of [false, true]) {
        for (const loudness of loudnesses) {
          for (const kind of kinds) {
            for (const isBot of [false, true]) {
              const events = [makeEvent({ kind, isBot, ruleLoudness: loudness })];
              expect(() => pingRule(events, target, viewer, quietRepo)).not.toThrow();
            }
          }
        }
      }
    }
  });
});
