import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr, makeReview, makeUserState, viewer } from './fixtures.ts';
import { prTier, type PrTierInput } from './pr-tier.ts';
import type { Viewer } from './types.ts';

const me = viewer.login;
const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };

function tier(overrides: Partial<PrTierInput>): string {
  return prTier({ pr: makePr(), events: [], viewer: withTeam, userState: null, reason: null, ...overrides });
}

const question = makeEvent({ kind: 'question_to_user', actor: 'ada', at: at(30) });

describe('prTier', () => {
  it('puts an unanswered question first, even on your own PR', () => {
    expect(tier({ pr: makePr({ author: me }), events: [question] })).toBe('needs_reply');
  });

  it('drops the ask once you commented after it', () => {
    const answered = makePr({ author: me, comments: [makeComment({ author: me, createdAt: at(40) })] });
    expect(tier({ pr: answered, events: [question] })).toBe('mine');
  });

  it('ignores bots and team mentions for needs_reply', () => {
    const bot = makeEvent({ kind: 'mention', actor: 'github-actions', isBot: true });
    const team = makeEvent({ kind: 'team_mention', actor: 'ada' });
    expect(tier({ events: [bot] })).toBe('rest');
    expect(tier({ events: [team] })).toBe('team_mentioned');
  });

  it('files teammates’ PRs as team when no review is owed', () => {
    expect(tier({ pr: makePr({ author: 'lyra' }) })).toBe('team');
    expect(tier({ pr: makePr({ author: 'lyra' }), viewer })).toBe('rest');
    const reviewed = makePr({ author: 'lyra', reviewerUsers: [me], reviews: [makeReview({ author: me, state: 'COMMENTED' })] });
    expect(tier({ pr: reviewed })).toBe('team');
  });

  it('counts an in-app approval as reviewed before GitHub shows it', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [me], headOid: 'c1' });
    expect(tier({ pr })).toBe('to_review');
    expect(tier({ pr, userState: makeUserState({ prKey: pr.key, approvedAt: at(30), approvedCommitOid: 'c1' }) })).toBe('rest');
  });

  it('puts a personal request on a teammate’s PR in To review', () => {
    expect(tier({ pr: makePr({ author: 'lyra', reviewerUsers: [me] }) })).toBe('to_review');
  });

  it('puts a team request on a teammate’s PR in To review until another teammate approves or asks for changes', () => {
    const pr = makePr({ author: 'lyra', reviewerTeams: ['PostHog/team-devex'] });
    expect(tier({ pr })).toBe('to_review');
    expect(tier({ pr: { ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] } })).toBe('to_review');
    expect(tier({ pr: { ...pr, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] } })).toBe('team');
  });

  it('keeps a routed team request in To review', () => {
    expect(tier({ pr: makePr({ author: 'ada', reviewerTeams: ['PostHog/team-devex'] }) })).toBe('to_review');
  });

  it('asks for review until you reviewed the head or approved any commit', () => {
    expect(tier({ pr: makePr({ author: 'ada', reviewerUsers: [me] }) })).toBe('to_review');
    expect(tier({ pr: makePr({ author: 'ada', reviewerTeams: ['PostHog/team-devex'] }) })).toBe('to_review');
    const reviewed = makePr({ author: 'ada', reviewerUsers: [me], reviews: [makeReview({ author: me, commitOid: 'head' })] });
    expect(tier({ pr: reviewed })).toBe('rest');
    const approvedOlder = makePr({ author: 'ada', reviewerUsers: [me], reviews: [makeReview({ author: me, commitOid: 'old' })] });
    expect(tier({ pr: approvedOlder })).toBe('rest');
    const commentedOlder = makePr({ author: 'ada', reviewerUsers: [me], reviews: [makeReview({ author: me, state: 'COMMENTED', commitOid: 'old' })] });
    expect(tier({ pr: commentedOlder })).toBe('to_review');
  });

  it('uses the team_mention reason too, and leaves closed PRs out', () => {
    expect(tier({ pr: makePr({ author: 'ada' }), reason: 'team_mention' })).toBe('team_mentioned');
    expect(tier({ pr: makePr({ author: me, state: 'MERGED' }) })).toBe('rest');
  });
});

describe('prTier on drafts', () => {
  it('never puts a draft in To review, but a personal question still counts', () => {
    const draft = makePr({ author: 'ada', isDraft: true, reviewerUsers: [me] });
    expect(tier({ pr: draft })).toBe('rest');
    expect(tier({ pr: { ...draft, isDraft: false } })).toBe('to_review');
    expect(tier({ pr: draft, events: [question] })).toBe('needs_reply');
  });
});
