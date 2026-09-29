import { describe, expect, it } from 'vitest';
import { at, makeComment, makeCommit, makeEvent, makePr, makeReview, makeUserState, viewer } from './fixtures.ts';
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
    const pr = makePr({ author: 'lyra', reviewerTeams: ['acme/team-platform'] });
    expect(tier({ pr })).toBe('to_review');
    expect(tier({ pr: { ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] } })).toBe('to_review');
    expect(tier({ pr: { ...pr, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] } })).toBe('team');
  });

  it('keeps a routed team request in To review', () => {
    expect(tier({ pr: makePr({ author: 'ada', reviewerTeams: ['acme/team-platform'] }) })).toBe('to_review');
  });

  it('asks for review until you reviewed the head or approved any commit', () => {
    expect(tier({ pr: makePr({ author: 'ada', reviewerUsers: [me] }) })).toBe('to_review');
    expect(tier({ pr: makePr({ author: 'ada', reviewerTeams: ['acme/team-platform'] }) })).toBe('to_review');
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

describe('prTier: Changes you requested', () => {
  const changes = makeReview({ id: 'r-changes', author: me, state: 'CHANGES_REQUESTED', submittedAt: at(20), commitOid: 'c0' });
  const standing = makePr({ author: 'ada', headOid: 'c0', reviews: [changes], commits: [makeCommit({ oid: 'c0', author: 'ada', committedAt: at(5) })] });
  const addressed = { ...standing, headOid: 'c1', commits: [...standing.commits, makeCommit({ oid: 'c1', author: 'ada', committedAt: at(40) })] };

  it('files a standing change request, whoever wrote the PR', () => {
    expect(tier({ pr: standing })).toBe('changes_requested');
    expect(tier({ pr: { ...standing, author: 'lyra' } })).toBe('changes_requested');
    expect(tier({ pr: { ...standing, isDraft: true } })).toBe('changes_requested');
  });

  it('keeps it there once the author addressed the changes, before any review request', () => {
    expect(tier({ pr: { ...addressed, reviewerUsers: [me] } })).toBe('changes_requested');
  });

  it('lets a later approval or dismissal clear it', () => {
    const approval = makeReview({ id: 'r-ok', author: me, state: 'APPROVED', submittedAt: at(50), commitOid: 'c1' });
    expect(tier({ pr: { ...addressed, reviews: [changes, approval] } })).toBe('rest');
    expect(tier({ pr: { ...standing, reviews: [{ ...changes, state: 'DISMISSED' }] } })).toBe('rest');
    // Someone else's change request is not the viewer's loop.
    expect(tier({ pr: { ...standing, reviews: [{ ...changes, author: 'rowan' }] } })).toBe('rest');
  });

  it('lets an ask from someone other than the author go first', () => {
    const lyra = makeEvent({ kind: 'question_to_user', actor: 'lyra', at: at(45) });
    expect(tier({ pr: addressed, events: [lyra] })).toBe('needs_reply');
    const author = makeEvent({ kind: 'question_to_user', actor: 'ada', at: at(45) });
    const authorComment = makeComment({ author: 'ada', createdAt: at(45) });
    expect(tier({ pr: { ...standing, comments: [authorComment] }, events: [author] })).toBe('changes_requested');
  });
});

describe('prTier: authorship', () => {
  it('keeps your own PR under mine in another team’s area, even with a team review request', () => {
    const pr = makePr({ author: me, repo: 'acme/infra', reviewerTeams: ['acme/team-platform', 'acme/team-infra'] });
    expect(tier({ pr, reason: 'team_mention' })).toBe('mine');
  });
});
