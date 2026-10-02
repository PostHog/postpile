import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeEvent, makePr, makeTimelineItem, viewer } from './fixtures.ts';
import { isLiveConversation, isPersonalPing, pingClickTarget, pingRule, pingTemplate, type PrPlace } from './pings.ts';
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

  it('treats bot-only news the agent raised to loud like a person\'s loud news', () => {
    // Decided 2026-09-30: a raised automation event wakes a snooze and pings; at its rule's loudness it stays bot.
    const botPush = makeEvent({ id: 'p', kind: 'commits_after_approval', actor: 'renovate[bot]', isBot: true, ruleLoudness: 'quiet', ruleReason: 'bot push' });
    const raisedPush = makeEvent({ ...botPush, override: { loudness: 'loud', reason: 'changes the approved runner image', by: 'agent' } });
    const raisedComment = makeEvent({ id: 'b', kind: 'bot_comment', actor: 'github-actions', isBot: true, ruleLoudness: 'quiet', override: { loudness: 'loud', reason: 'coverage dropped', by: 'user' } });
    expect(pingRule([botPush], pr, viewer, false)).toMatchObject({ class: 'bot' });
    expect(pingRule([raisedPush], pr, viewer, false)).toMatchObject({ class: 'addressed', loudness: 'loud', reason: 'changes the approved runner image' });
    expect(pingRule([raisedComment], pr, viewer, false)).toMatchObject({ class: 'not_addressed', reason: 'coverage dropped' });
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

describe('isPersonalPing', () => {
  const personalRequest = makePr({ number: 30, author: 'alice', timeline: [makeTimelineItem({ id: 'rr-me', subject: viewer.login })] });
  const teamRequest = makePr({ number: 31, author: 'alice', timeline: [makeTimelineItem({ id: 'rr-team', subject: 'acme/team-platform' })] });

  it('counts mentions, questions and replies', () => {
    for (const kind of ['mention', 'question_to_user', 'reply_to_user'] as const) {
      expect(isPersonalPing(makeEvent({ id: kind, kind }), pr, viewer)).toBe(true);
    }
  });

  it('counts a review request that names the viewer', () => {
    expect(isPersonalPing(makeEvent({ id: 'r', kind: 'review_requested', sourceId: 'rr-me' }), personalRequest, viewer)).toBe(true);
  });

  it('skips a review request for a team', () => {
    expect(isPersonalPing(makeEvent({ id: 'r', kind: 'review_requested', sourceId: 'rr-team' }), teamRequest, viewer)).toBe(false);
  });

  it('skips a review request for a bare team slug, and one without a subject', () => {
    const bare = makePr({ number: 32, author: 'alice', timeline: [makeTimelineItem({ id: 'rr-bare', subject: 'team-platform' })] });
    expect(isPersonalPing(makeEvent({ id: 'r', kind: 'review_requested', sourceId: 'rr-bare' }), bare, viewer)).toBe(false);
    expect(isPersonalPing(makeEvent({ id: 'r', kind: 'review_requested', sourceId: 'gone' }), bare, viewer)).toBe(false);
  });

  it('matches the viewer login without regard to case', () => {
    const shouting = makePr({ number: 33, author: 'alice', timeline: [makeTimelineItem({ id: 'rr-up', subject: viewer.login.toUpperCase() })] });
    expect(isPersonalPing(makeEvent({ id: 'r', kind: 'review_requested', sourceId: 'rr-up' }), shouting, viewer)).toBe(true);
  });

  it('skips team mentions and other kinds', () => {
    expect(isPersonalPing(makeEvent({ id: 't', kind: 'team_mention' }), pr, viewer)).toBe(false);
    expect(isPersonalPing(makeEvent({ id: 'c', kind: 'review_changes_requested' }), pr, viewer)).toBe(false);
  });
});

describe('isLiveConversation', () => {
  const pr = makePr();
  const ownComment = makeEvent({ id: 'own', kind: 'comment', actor: viewer.login, at: '2026-09-02T10:00:00.000Z' });
  const reply = (at: string, overrides = {}) => makeEvent({ id: 'reply', kind: 'reply_to_user', actor: 'bob', at, ...overrides });

  it('counts a person answering within two hours of the viewer talking on the PR', () => {
    const answer = reply('2026-09-02T11:30:00.000Z');
    expect(isLiveConversation(answer, pr, [ownComment, answer], viewer)).toBe(true);
    const mention = reply('2026-09-02T12:00:00.000Z', { kind: 'mention' });
    expect(isLiveConversation(mention, pr, [ownComment, mention], viewer)).toBe(true);
  });

  it('does not count an answer later than two hours, from a bot, or without the viewer talking first', () => {
    const late = reply('2026-09-02T12:00:01.000Z');
    expect(isLiveConversation(late, pr, [ownComment, late], viewer)).toBe(false);
    const bot = reply('2026-09-02T10:30:00.000Z', { actor: 'helper[bot]', isBot: true });
    expect(isLiveConversation(bot, pr, [ownComment, bot], viewer)).toBe(false);
    const alone = reply('2026-09-02T10:30:00.000Z');
    expect(isLiveConversation(alone, pr, [alone], viewer)).toBe(false);
  });

  it('needs words from the viewer: an approval alone is not talking, and a plain comment is no answer', () => {
    const approval = makeEvent({ id: 'ok', kind: 'review_approved', actor: viewer.login, at: '2026-09-02T10:00:00.000Z' });
    const answer = reply('2026-09-02T10:30:00.000Z');
    expect(isLiveConversation(answer, pr, [approval, answer], viewer)).toBe(false);
    const plain = makeEvent({ id: 'plain', kind: 'comment', actor: 'bob', at: '2026-09-02T10:30:00.000Z' });
    expect(isLiveConversation(plain, pr, [ownComment, plain], viewer)).toBe(false);
  });
});

describe('pingClickTarget', () => {
  // Pinged in topic "ci" on the single tile; since then a set took the PR in and the tidy moved it to "depot".
  const pinged = { topicId: 'ci', tileId: 'pr:acme/app#7', prKey: 'acme/app#7' };
  const board = new Map<string, PrPlace>([
    ['acme/app#7', { topicId: 'depot', tileId: 'set:s1' }],
    ['acme/app#9', { topicId: 'docs', tileId: 'pr:acme/app#9' }],
  ]);
  const placeOf = (prKey: string) => board.get(prKey) ?? null;
  const openable = new Set(['ci', 'depot', 'docs']);

  it('opens the tile that holds the PR now, not the ids it pinged with', () => {
    const target = pingClickTarget({ target: pinged, prKeys: ['acme/app#7'] }, placeOf, (id) => openable.has(id));
    expect(target).toEqual({ topicId: 'depot', tileId: 'set:s1', prKey: 'acme/app#7' });
  });

  it('opens a summary at its first PR still on the board', () => {
    const gone = { topicId: 'ci', tileId: 'pr:acme/app#1', prKey: 'acme/app#1' };
    const target = pingClickTarget({ target: gone, prKeys: ['acme/app#1', 'acme/app#9', 'acme/app#7'] }, placeOf, (id) => openable.has(id));
    expect(target).toEqual({ topicId: 'docs', tileId: 'pr:acme/app#9', prKey: 'acme/app#9' });
  });

  it('opens the pinged topic once the PR left the board, and nothing once the topic is gone too', () => {
    const gone = { topicId: 'ci', tileId: 'pr:acme/app#1', prKey: 'acme/app#1' };
    expect(pingClickTarget({ target: gone, prKeys: ['acme/app#1'] }, placeOf, (id) => openable.has(id))).toEqual({ topicId: 'ci', tileId: null, prKey: 'acme/app#1' });
    expect(pingClickTarget({ target: gone, prKeys: ['acme/app#1'] }, placeOf, () => false)).toBeNull();
    expect(pingClickTarget({ target: null, prKeys: [] }, placeOf, () => true)).toBeNull();
  });
});
