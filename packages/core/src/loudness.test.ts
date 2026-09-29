import { describe, expect, it } from 'vitest';
import { makeEvent, makePr, makeUserState, viewer } from './fixtures.ts';
import { displayState, effectiveLoudness, isUnseenLoud, ruleLoudness, type LoudnessInput } from './loudness.ts';

function input(overrides: Partial<LoudnessInput>): LoudnessInput {
  return {
    kind: 'comment',
    actor: 'bob',
    isBot: false,
    pr: makePr(),
    viewer,
    userState: null,
    ...overrides,
  };
}

describe('ruleLoudness', () => {
  it('keeps the viewer own activity quiet, even a push after approval', () => {
    expect(ruleLoudness(input({ kind: 'mention', actor: 'Viewer' })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'commits_after_approval', actor: 'viewer' })).loudness).toBe('quiet');
  });

  it('makes direct address loud', () => {
    expect(ruleLoudness(input({ kind: 'mention' }))).toEqual({ loudness: 'loud', reason: 'mentions you' });
    expect(ruleLoudness(input({ kind: 'question_to_user' })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'reply_to_user' })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'team_mention' })).loudness).toBe('loud');
  });

  it('drops a mention to quiet once the viewer replied after it', () => {
    const decision = ruleLoudness(input({ kind: 'mention', userRepliedAfter: true }));
    expect(decision).toEqual({ loudness: 'quiet', reason: 'you already replied' });
  });

  it('keeps bot mentions, CI, deploys and the merge queue quiet', () => {
    expect(ruleLoudness(input({ kind: 'mention', actor: 'github-actions', isBot: true })).loudness).toBe('quiet');
    for (const kind of ['ci', 'deploy', 'merge_queue', 'bot_comment'] as const) {
      expect(ruleLoudness(input({ kind, actor: 'someone' })).loudness).toBe('quiet');
    }
  });

  it('never makes a CI result loud, not even a failure on the viewer own PR (CI is not a signal)', () => {
    const own = makePr({ author: viewer.login, checks: { rollup: 'FAILURE', contexts: [] } });
    for (const pr of [own, makePr({ checks: { rollup: 'FAILURE', contexts: [] } }), makePr({ isDraft: true })]) {
      expect(ruleLoudness(input({ kind: 'ci', actor: '', isBot: true, pr })).loudness).toBe('quiet');
    }
  });

  it('mutes a bot rebase on a draft but not on a ready PR', () => {
    const draft = makePr({ isDraft: true });
    expect(ruleLoudness(input({ kind: 'force_pushed', actor: 'trunk-io', isBot: true, pr: draft }))).toEqual({
      loudness: 'muted',
      reason: 'bot pushed to a draft',
    });
    expect(ruleLoudness(input({ kind: 'commits_pushed', actor: 'renovate', isBot: true, pr: draft })).loudness).toBe(
      'muted',
    );
    const afterApproval = input({ kind: 'commits_after_approval', actor: 'renovate', isBot: true, pr: draft });
    expect(ruleLoudness(afterApproval).loudness).toBe('muted');
    expect(ruleLoudness(input({ kind: 'force_pushed', actor: 'trunk-io', isBot: true })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'force_pushed', actor: 'alice', pr: draft })).loudness).toBe('quiet');
  });

  it('makes a review request loud only when it is for the viewer or their team', () => {
    expect(ruleLoudness(input({ kind: 'review_requested', subject: 'viewer' })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'review_requested', subject: 'acme/team-platform' })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'review_requested', subject: 'team-platform' })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'review_requested', subject: 'carol' })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'review_requested', subject: null })).loudness).toBe('quiet');
  });

  it('keeps new commits after approval quiet; only the agent may raise them', () => {
    const decision = ruleLoudness(
      input({ kind: 'commits_after_approval', actor: 'alice', userState: makeUserState({ approvedAt: 'x' }) }),
    );
    expect(decision).toEqual({ loudness: 'quiet', reason: 'new commits after you approved' });
  });

  it('never makes merged without review loud: the done rule surfaces it instead', () => {
    expect(ruleLoudness(input({ kind: 'merged_without_review' })).loudness).toBe('quiet');
  });

  it('makes human reviews and comments loud on the viewer own PR only', () => {
    const mine = makePr({ author: 'viewer' });
    expect(ruleLoudness(input({ kind: 'review_changes_requested', pr: mine })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'comment', pr: mine })).loudness).toBe('loud');
    expect(ruleLoudness(input({ kind: 'review_approved' })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'comment' })).loudness).toBe('quiet');
  });

  it('keeps plain lifecycle events quiet', () => {
    for (const kind of ['merged', 'closed', 'reopened', 'ready_for_review', 'commits_pushed'] as const) {
      expect(ruleLoudness(input({ kind, actor: 'alice' })).loudness).toBe('quiet');
    }
  });
});

describe('effective loudness and display state', () => {
  it('prefers the override over the rule', () => {
    const event = makeEvent({ ruleLoudness: 'loud', override: { loudness: 'muted', reason: 'noise', by: 'agent' } });
    expect(effectiveLoudness(event)).toBe('muted');
    expect(isUnseenLoud(event)).toBe(false);
  });

  it('shows seen once read, whatever the loudness', () => {
    expect(displayState(makeEvent({ ruleLoudness: 'loud', seenAt: 'x' }))).toBe('seen');
    expect(displayState(makeEvent({ ruleLoudness: 'loud' }))).toBe('loud');
    expect(isUnseenLoud(makeEvent({ ruleLoudness: 'loud' }))).toBe(true);
  });
});

describe('ruleLoudness on drafts', () => {
  const draft = makePr({ author: 'rowan', isDraft: true, reviewerUsers: [viewer.login] });

  it('keeps a review request and commits after approval quiet on a draft', () => {
    expect(ruleLoudness(input({ kind: 'review_requested', pr: draft, subject: viewer.login })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'commits_after_approval', pr: draft })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'mention', pr: draft })).loudness).toBe('loud');
  });

  it('makes mark-ready loud when a review is asked of you or your team', () => {
    const ready = makePr({ author: 'rowan', reviewerUsers: [viewer.login] });
    expect(ruleLoudness(input({ kind: 'ready_for_review', actor: 'rowan', pr: ready }))).toEqual({ loudness: 'loud', reason: 'ready for your review' });
    expect(ruleLoudness(input({ kind: 'ready_for_review', actor: 'rowan', pr: makePr({ author: 'rowan' }) })).loudness).toBe('quiet');
    expect(ruleLoudness(input({ kind: 'ready_for_review', actor: 'rowan', pr: makePr({ author: 'rowan', reviewerTeams: ['acme/team-platform'] }) })).loudness).toBe('loud');
  });
});
