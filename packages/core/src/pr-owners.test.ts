import { describe, expect, it } from 'vitest';
import { changesAnswered } from './changes-answered.ts';
import { at, makeComment, makePr, makeReview, singleTile, viewer } from './fixtures.ts';
import { forWhom } from './for-whom.ts';
import { isBotAuthor, isPrOwner, prOwner, prOwners } from './pr-owners.ts';
import { prTier } from './pr-tier.ts';
import { reviewPending, reviewRequest } from './review-request.ts';
import { tilePeople } from './tile-people.ts';
import { ownerRelation, topicPeople } from './topic-queues.ts';
import { topicDriver } from './topic-roles.ts';
import type { Pr, Viewer } from './types.ts';
import { whoseTurn } from './whose-turn.ts';
import { whyHere } from './why-here.ts';

const me = viewer.login;
const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };
const BOT = 'acme-agent[bot]';

/** An agent PR: a GitHub App opened it on behalf of its assignees. */
function agentPr(assignees: string[], overrides: Partial<Pr> & { number?: number } = {}): Pr {
  return makePr({ author: BOT, assignees, headRef: 'acme-agent/fix-cache', ...overrides });
}

function tierOf(pr: Pr, who: Viewer = withTeam): string {
  return prTier({ pr, events: [], viewer: who, userState: null, reason: null });
}

function turnOf(pr: Pr, who: Viewer = withTeam) {
  return whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map(), userStates: new Map(), viewer: who });
}

describe('isBotAuthor', () => {
  it('is true for app accounts and automation on user accounts, never for a deleted author', () => {
    expect(isBotAuthor(BOT)).toBe(true);
    expect(isBotAuthor('renovate')).toBe(true);
    expect(isBotAuthor('alice')).toBe(false);
    expect(isBotAuthor('')).toBe(false);
  });
});

describe('prOwners', () => {
  it('is the author for a person’s PR, assignees or not', () => {
    expect(prOwners(makePr({ author: 'alice' }))).toEqual(['alice']);
    expect(prOwners(makePr({ author: 'alice', assignees: [me, 'bob'] }))).toEqual(['alice']);
  });

  it('is the assignees for a bot’s PR, and the bot while nobody is assigned', () => {
    expect(prOwners(agentPr([me, 'lyra']))).toEqual([me, 'lyra']);
    expect(prOwners(agentPr([]))).toEqual([BOT]);
    // Snapshots stored before assignees were fetched have none.
    expect(prOwners(makePr({ author: BOT, assignees: undefined }))).toEqual([BOT]);
  });

  it('keeps a deleted author (empty login) as the owner, assignees or not', () => {
    expect(prOwners(makePr({ author: '', assignees: [me] }))).toEqual(['']);
    expect(isPrOwner(makePr({ author: '', assignees: [me] }), me)).toBe(false);
  });

  it('matches logins without case and names the first owner', () => {
    expect(isPrOwner(agentPr(['Viewer']), me)).toBe(true);
    expect(isPrOwner(agentPr(['lyra']), me)).toBe(false);
    expect(isPrOwner(makePr({ author: 'alice', assignees: [me] }), me)).toBe(false);
    expect(prOwner(agentPr(['lyra', me]))).toBe('lyra');
    expect(prOwner(makePr({ author: 'alice' }))).toBe('alice');
  });
});

describe('an agent PR assigned to the viewer', () => {
  const pr = agentPr([me]);

  it('is their PR: tier mine, "Your PR", owner relation you', () => {
    expect(tierOf(pr)).toBe('mine');
    expect(forWhom('AS', pr, withTeam)).toEqual({ kind: 'own' });
    expect(ownerRelation(pr, withTeam)).toBe('you');
  });

  it('asks them to merge once approved, like their own PR', () => {
    const approved = agentPr([me], { reviewDecision: 'APPROVED', reviews: [makeReview({ author: 'rowan' })] });
    expect(turnOf(approved)).toMatchObject({ kind: 'you', move: 'merge' });
  });

  it('owes no review to their own agent’s PR', () => {
    const requested = agentPr([me], { reviewerUsers: [me] });
    expect(reviewPending(requested, withTeam)).toBe(false);
    expect(tierOf(requested)).toBe('mine');
  });

  it('shows the viewer, not the bot, as the tile’s owner face', () => {
    expect(tilePeople([pr], me)).toEqual([{ login: me, role: 'you' }]);
  });

  it('stays someone else’s when a person opened it and only assigned the viewer', () => {
    const human = makePr({ author: 'alice', assignees: [me] });
    expect(tierOf(human)).toBe('rest');
    expect(ownerRelation(human, withTeam)).toBe('other');
  });
});

describe('an agent PR assigned to a teammate', () => {
  const pr = agentPr(['lyra']);

  it('is a teammate’s PR: tier team, owner relation team', () => {
    expect(tierOf(pr)).toBe('team');
    expect(ownerRelation(pr, withTeam)).toBe('team');
  });

  it('turns a team request into one for the viewer, naming the owner', () => {
    const requested = agentPr(['lyra'], { reviewerTeams: ['acme/team-platform'] });
    expect(reviewRequest(requested, withTeam)).toBe('team_for_you');
    expect(forWhom('RT', requested, withTeam)).toEqual({ kind: 'you' });
    expect(turnOf(requested)).toMatchObject({ kind: 'you', move: 'review', what: "Review for team-platform: lyra's PR" });
  });

  it('names the owner, not the bot, as the one to merge after the viewer approved', () => {
    const approved = agentPr(['lyra'], { reviews: [makeReview({ author: me, state: 'APPROVED' })] });
    expect(turnOf(approved)).toMatchObject({ kind: 'them', who: 'lyra', what: 'to merge' });
  });

  it('counts the owner’s reply as the answer to the viewer’s changes request', () => {
    const changes = makeReview({ author: me, state: 'CHANGES_REQUESTED', submittedAt: at(10) });
    const replied = agentPr(['lyra'], { reviews: [changes], comments: [makeComment({ author: 'lyra', createdAt: at(20) })] });
    expect(changesAnswered(replied, withTeam)).toMatchObject({ replied: true, pushed: false });
    expect(turnOf(replied)).toMatchObject({ kind: 'you', move: 're_review', what: 'lyra replied to your review' });
  });

  it('shows the owner in the topic faces and counts them as the driver', () => {
    expect(topicPeople([pr, agentPr([])], withTeam)).toEqual([{ login: 'lyra', relation: 'team' }]);
    expect(topicDriver([pr, agentPr(['lyra'], { number: 2 }), makePr({ author: 'ada', number: 3 })])).toBe('lyra');
    expect(tilePeople([pr], me)).toEqual([{ login: 'lyra', role: 'assignee' }]);
  });
});

describe('a person’s PR found because it is assigned to the viewer', () => {
  const assigned = { kind: 'found' as const, via: 'assigned' as const, reason: 'assigned to you' };

  it('is aimed at the viewer (AS, "For you") but stays the author’s', () => {
    const pr = makePr({ author: 'ada', assignees: [me] });
    expect(whyHere(assigned, pr, withTeam)).toBe('AS');
    expect(forWhom('AS', pr, withTeam)).toEqual({ kind: 'you' });
    expect(tierOf(pr)).toBe('rest');
    expect(turnOf(pr)).toMatchObject({ kind: 'none' });
    expect(ownerRelation(pr, withTeam)).toBe('other');
  });

  it('files a teammate’s assigned PR under team and a requested review under To review', () => {
    expect(tierOf(makePr({ author: 'lyra', assignees: [me] }))).toBe('team');
    expect(tierOf(makePr({ author: 'ada', assignees: [me], reviewerUsers: [me] }))).toBe('to_review');
  });

  it('keeps a bot PR found through the same search the viewer’s own', () => {
    const pr = agentPr([me]);
    expect(whyHere({ kind: 'found', via: 'own_open', reason: 'agent PR assigned to you' }, pr, withTeam)).toBe('AU');
    expect(forWhom('AU', pr, withTeam)).toEqual({ kind: 'own' });
  });
});
