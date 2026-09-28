import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr, makeReview, viewer } from './fixtures.ts';
import { prTier, type PrTierInput } from './pr-tier.ts';
import type { Viewer } from './types.ts';

const me = viewer.login;
const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };

function tier(overrides: Partial<PrTierInput>): string {
  return prTier({ pr: makePr(), events: [], viewer: withTeam, reason: null, ...overrides });
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

  it('files teammates’ PRs as team, before review requests', () => {
    expect(tier({ pr: makePr({ author: 'lyra', reviewerUsers: [me] }) })).toBe('team');
    expect(tier({ pr: makePr({ author: 'lyra' }), viewer })).toBe('rest');
  });

  it('asks for review until you reviewed the head', () => {
    expect(tier({ pr: makePr({ author: 'ada', reviewerUsers: [me] }) })).toBe('to_review');
    expect(tier({ pr: makePr({ author: 'ada', reviewerTeams: ['PostHog/team-devex'] }) })).toBe('to_review');
    const reviewed = makePr({ author: 'ada', reviewerUsers: [me], reviews: [makeReview({ author: me, commitOid: 'head' })] });
    expect(tier({ pr: reviewed })).toBe('rest');
    const olderHead = makePr({ author: 'ada', reviewerUsers: [me], reviews: [makeReview({ author: me, commitOid: 'old' })] });
    expect(tier({ pr: olderHead })).toBe('to_review');
  });

  it('uses the team_mention reason too, and leaves closed PRs out', () => {
    expect(tier({ pr: makePr({ author: 'ada' }), reason: 'team_mention' })).toBe('team_mentioned');
    expect(tier({ pr: makePr({ author: me, state: 'MERGED' }) })).toBe('rest');
  });
});
