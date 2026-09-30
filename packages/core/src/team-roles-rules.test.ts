// The rules with team roles (2026-09-30): a home team behaves like every
// team did before; a routing team only routes review requests and mentions.
import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeEvent, makePr, makeReview, makeTimelineItem, singleTile, viewer } from './fixtures.ts';
import { forWhom, tileForWhom } from './for-whom.ts';
import { isRoutedTeamRequestEvent, routedTeamRequest } from './glance-pings.ts';
import { ruleLoudness } from './loudness.ts';
import { pingRule } from './pings.ts';
import { prTier } from './pr-tier.ts';
import { requestedTeam, reviewPending, reviewRequest, teamRequestHold, teamRequestTakenBy } from './review-request.ts';
import { personRelation, topicPeople } from './topic-queues.ts';
import type { Pr, PrEvent, Viewer } from './types.ts';
import { whoseTurn } from './whose-turn.ts';
import { whyHere } from './why-here.ts';

const HOME = 'acme/team-platform';
const ROUTING = 'acme/client-approvers';
const me = viewer.login;

/** team-platform is home (lyra, rowan), client-approvers only routes reviews. */
const roled: Viewer = { login: me, teams: [HOME, ROUTING], homeTeams: [HOME], teamMembers: ['lyra', 'rowan'] };
/** Both teams only route: no teammates at all. */
const noHome: Viewer = { login: me, teams: [HOME, ROUTING], homeTeams: [], teamMembers: [] };

function turn(pr: Pr, who: Viewer = roled, events: PrEvent[] = []) {
  return whoseTurn({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, events]]),
    userStates: new Map(),
    viewer: who,
  });
}

function tier(pr: Pr, who: Viewer = roled, events: PrEvent[] = []) {
  return prTier({ pr, events, viewer: who, userState: null, reason: null });
}

describe('reviewRequest with home and routing teams', () => {
  it('keeps a home team request on a teammate\'s PR "for you"', () => {
    expect(reviewRequest(makePr({ author: 'lyra', reviewerTeams: [HOME] }), roled)).toBe('team_for_you');
  });

  it('keeps a routing team request routed, even on a teammate\'s PR', () => {
    expect(reviewRequest(makePr({ author: 'ada', reviewerTeams: [ROUTING] }), roled)).toBe('team');
    expect(reviewRequest(makePr({ author: 'lyra', reviewerTeams: [ROUTING] }), roled)).toBe('team');
  });

  it('lets anyone\'s review of the head take a routing team request, not the author\'s or a bot\'s', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: [ROUTING] });
    const old = { ...pr, reviews: [makeReview({ author: 'mira', state: 'COMMENTED', commitOid: 'old' })] };
    expect(reviewRequest(old, roled)).toBe('team');
    const onHead = { ...pr, reviews: [makeReview({ author: 'mira', state: 'COMMENTED' })] };
    expect(reviewRequest(onHead, roled)).toBe('team_taken');
    expect(teamRequestTakenBy(onHead, roled)).toEqual(['mira']);
    const ownAndBot = { ...pr, reviews: [makeReview({ author: 'ada' }), makeReview({ author: 'reviewbot[bot]' })] };
    expect(reviewRequest(ownAndBot, roled)).toBe('team');
    expect(reviewPending(pr, roled)).toBe(true);
    expect(reviewPending(onHead, roled)).toBe(false);
  });

  it('answers for the team owed most, a home team on a tie', () => {
    const both = makePr({ author: 'ada', reviewerTeams: [ROUTING, HOME] });
    expect(reviewRequest(both, roled)).toBe('team');
    expect(requestedTeam(both, roled)).toBe(HOME);
    // A teammate took the home request on an older commit; nobody reviewed the head for the routing team.
    const homeTaken = { ...both, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED', commitOid: 'old' })] };
    expect(reviewRequest(homeTaken, roled)).toBe('team');
    expect(requestedTeam(homeTaken, roled)).toBe(ROUTING);
    const onTeammatePr = makePr({ author: 'lyra', reviewerTeams: [ROUTING, HOME] });
    expect(reviewRequest(onTeammatePr, roled)).toBe('team_for_you');
    expect(requestedTeam(onTeammatePr, roled)).toBe(HOME);
  });

  it('puts a routing team request on hold like any routed one', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: [ROUTING], reviews: [makeReview({ author: 'sol', state: 'CHANGES_REQUESTED', commitOid: 'old' })] });
    expect(teamRequestHold(pr, roled, false)).toEqual({ kind: 'changes', by: 'sol' });
    expect(teamRequestHold(makePr({ author: 'ada', reviewerTeams: [ROUTING] }), roled, true)).toEqual({ kind: 'not_yours' });
  });

  it('has no teammates without a home team', () => {
    expect(reviewRequest(makePr({ author: 'lyra', reviewerTeams: [HOME] }), noHome)).toBe('team');
    const reviewed = makePr({ author: 'lyra', reviewerTeams: [HOME], reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] });
    expect(reviewRequest(reviewed, noHome)).toBe('team_taken');
  });

  it('keeps every team home before roles are decided', () => {
    const before: Viewer = { login: me, teams: [HOME, ROUTING], teamMembers: ['lyra'] };
    expect(reviewRequest(makePr({ author: 'lyra', reviewerTeams: [ROUTING] }), before)).toBe('team_for_you');
  });
});

describe('whose turn with home and routing teams', () => {
  it('names the routing team and never says "lyra\'s PR" for it', () => {
    expect(turn(makePr({ author: 'ada', reviewerTeams: [ROUTING] }))).toMatchObject({ kind: 'you', what: 'Review for client-approvers' });
    expect(turn(makePr({ author: 'lyra', reviewerTeams: [ROUTING] }))).toMatchObject({ kind: 'you', what: 'Review for client-approvers' });
    expect(turn(makePr({ author: 'lyra', reviewerTeams: [HOME] }))).toMatchObject({ kind: 'you', what: "Review for team-platform: lyra's PR" });
  });

  it('hands a taken routing request to whoever reviewed the head', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: [ROUTING], reviews: [makeReview({ author: 'mira', state: 'COMMENTED' })] });
    expect(turn(pr)).toMatchObject({ kind: 'them', who: 'mira', what: 'is reviewing' });
  });

  it('asks for a review when a bot made the routing request', () => {
    const pr = makePr({
      author: 'ada',
      reviewerTeams: [ROUTING],
      timeline: [makeTimelineItem({ actor: 'pr-assigner[bot]', subject: ROUTING })],
    });
    expect(turn(pr)).toMatchObject({ kind: 'you', what: 'Review for client-approvers' });
  });
});

describe('tiers with home and routing teams', () => {
  it('puts routing team requests in To review, also on a teammate\'s PR', () => {
    expect(tier(makePr({ author: 'ada', reviewerTeams: [ROUTING] }))).toBe('to_review');
    expect(tier(makePr({ author: 'lyra', reviewerTeams: [ROUTING] }))).toBe('to_review');
  });

  it('keeps a teammate\'s PR in Team\'s PRs once the routing request is taken', () => {
    const taken = makePr({ author: 'lyra', reviewerTeams: [ROUTING], reviews: [makeReview({ author: 'mira', state: 'COMMENTED' })] });
    expect(tier(taken)).toBe('team');
  });

  it('has no Team\'s PRs without a home team', () => {
    expect(tier(makePr({ author: 'lyra' }), noHome)).toBe('rest');
    expect(tier(makePr({ author: 'lyra' }), roled)).toBe('team');
  });
});

describe('for whom with home and routing teams', () => {
  it('gives a routing team the neutral chip, never "for you"', () => {
    expect(forWhom('RT', makePr({ author: 'ada', reviewerTeams: [ROUTING] }), roled)).toEqual({ kind: 'routing', team: 'client-approvers' });
    expect(forWhom('RT', makePr({ author: 'lyra', reviewerTeams: [ROUTING] }), roled)).toEqual({ kind: 'routing', team: 'client-approvers' });
    expect(forWhom('RT', makePr({ author: 'ada', reviewerTeams: [HOME] }), roled)).toEqual({ kind: 'team', team: 'team-platform' });
  });

  it('names the home team first in the timeline and in mentions', () => {
    const timeline = [makeTimelineItem({ id: 't1', subject: ROUTING }), makeTimelineItem({ id: 't2', subject: HOME })];
    expect(forWhom('RT', makePr({ author: 'ada', timeline }), roled)).toEqual({ kind: 'team', team: 'team-platform' });
    const routingOnly = makePr({ author: 'ada', comments: [makeComment({ body: 'cc @acme/client-approvers' })] });
    expect(forWhom('@T', routingOnly, roled)).toEqual({ kind: 'routing', team: 'client-approvers' });
  });

  it('ranks a home team over a routing team over your own PR', () => {
    const routing = { kind: 'routing' as const, team: 'client-approvers' };
    expect(tileForWhom([{ kind: 'own' }, routing])).toEqual(routing);
    expect(tileForWhom([routing, { kind: 'team', team: 'team-platform' }])).toEqual({ kind: 'team', team: 'team-platform' });
  });

  it('keeps the RT code for a routing team', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: [ROUTING] });
    expect(whyHere({ kind: 'pinged', reason: 'review_requested' }, pr, roled)).toBe('RT');
  });
});

describe('loudness with home and routing teams', () => {
  it('makes a routing team mention FYI and a home team mention loud', () => {
    const routing = makePr({ author: 'ada', comments: [makeComment({ id: 'c1', author: 'ada', body: '@acme/client-approvers can you look?' })] });
    const [routingEvent] = deriveEvents(routing, roled, null);
    expect(routingEvent).toMatchObject({ kind: 'team_mention', ruleLoudness: 'quiet', ruleReason: 'mentions a team that only routes reviews to you' });
    const home = makePr({ author: 'ada', comments: [makeComment({ id: 'c1', author: 'ada', body: '@acme/team-platform and @acme/client-approvers' })] });
    expect(deriveEvents(home, roled, null)[0]).toMatchObject({ kind: 'team_mention', ruleLoudness: 'loud' });
    expect(deriveEvents(routing, { login: me, teams: [HOME, ROUTING] }, null)[0]).toMatchObject({ ruleLoudness: 'loud' });
  });

  it('keeps a routing team review request loud, whoever made it', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: [ROUTING] });
    const base = { kind: 'review_requested' as const, pr, viewer: roled, userState: null, subject: ROUTING };
    expect(ruleLoudness({ ...base, actor: 'remy', isBot: false }).loudness).toBe('loud');
    expect(ruleLoudness({ ...base, actor: 'pr-assigner[bot]', isBot: true }).loudness).toBe('loud');
  });

  it('asks nothing with a routing team mention', () => {
    const pr = makePr({ author: 'ada' });
    const mention = makeEvent({ kind: 'team_mention', actor: 'ada', at: at(10), ruleLoudness: 'quiet', ruleReason: 'mentions a team that only routes reviews to you' });
    expect(turn(pr, roled, [mention]).kind).toBe('none');
  });
});

describe('routed pings with home and routing teams', () => {
  it('treats a routing team request as routed, also on a teammate\'s PR', () => {
    const pr = makePr({ author: 'lyra', reviewerTeams: [ROUTING], timeline: [makeTimelineItem({ id: 't1', actor: 'pr-assigner[bot]', subject: ROUTING })] });
    expect(routedTeamRequest(pr, roled)).toBe(ROUTING);
    const event = makeEvent({ id: 'e1', kind: 'review_requested', actor: 'pr-assigner[bot]', isBot: true, sourceId: 't1', ruleLoudness: 'loud' });
    expect(isRoutedTeamRequestEvent(event, pr, roled)).toBe(true);
    expect(pingRule([event], pr, roled, false).class).toBe('routed');
  });

  it('keeps a home team request on a teammate\'s PR addressed', () => {
    const pr = makePr({ author: 'lyra', reviewerTeams: [HOME], timeline: [makeTimelineItem({ id: 't1', actor: 'pr-assigner[bot]', subject: HOME })] });
    expect(routedTeamRequest(pr, roled)).toBeNull();
    const event = makeEvent({ id: 'e1', kind: 'review_requested', actor: 'pr-assigner[bot]', isBot: true, sourceId: 't1', ruleLoudness: 'loud' });
    expect(pingRule([event], pr, roled, false).class).toBe('addressed');
  });
});

describe('people with home and routing teams', () => {
  it('counts only home team members as teammates', () => {
    expect(personRelation('lyra', roled)).toBe('team');
    expect(personRelation('lyra', noHome)).toBe('other');
    const people = topicPeople([makePr({ author: 'lyra' }), makePr({ number: 2, author: 'ada' })], noHome);
    expect(people.map((person) => person.relation)).toEqual(['other', 'other']);
  });
});
