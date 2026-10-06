import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr, makeUserState, viewer } from './fixtures.ts';
import { displayState, effectiveLoudness, findLoudnessRow, isUnseenLoud, ruleLoudness, type LoudnessInput } from './loudness.ts';

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

  it('keeps bot mentions, deploys and the merge queue quiet', () => {
    expect(ruleLoudness(input({ kind: 'mention', actor: 'github-actions', isBot: true })).loudness).toBe('quiet');
    for (const kind of ['deploy', 'merge_queue', 'bot_comment'] as const) {
      expect(ruleLoudness(input({ kind, actor: 'someone' })).loudness).toBe('quiet');
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

describe('ruleLoudness for the merge queue', () => {
  const testing = makeComment({ id: 't1', author: 'trunk-io[bot]', body: '<!-- Trunk Merge -->\n🧪\u2002Running tests on this pull request - [details](https://trunk.example/1).', createdAt: at(5) });
  const failed = makeComment({
    id: 't2',
    author: 'trunk-io[bot]',
    body: 'Stacked PR [12](https://github.com/acme/app/pull/12) failed testing in the merge queue. Please investigate the failure and re-submit the stack.',
    createdAt: at(9),
  });
  const own = makePr({ author: 'viewer', comments: [testing, failed] });
  const trunkEvent = (pr: typeof own, kind: 'bot_comment' | 'comment_edited', minutes: number) => input({ kind, actor: 'trunk-io[bot]', isBot: true, at: at(minutes), pr });

  it('makes the trunk comment that took your PR out of the queue loud, with the reason', () => {
    expect(ruleLoudness(trunkEvent(own, 'bot_comment', 9))).toEqual({ loudness: 'loud', reason: 'removed from the merge queue: tests failed' });
    // The same failure as an edit of trunk's sticky comment.
    const sticky = makePr({ author: 'viewer', comments: [{ ...testing, body: failed.body, lastEditedAt: at(12) }] });
    expect(ruleLoudness(trunkEvent(sticky, 'comment_edited', 12)).loudness).toBe('loud');
  });

  it('keeps every other trunk status quiet, and failures on PRs that are not yours', () => {
    expect(ruleLoudness(trunkEvent(own, 'bot_comment', 5))).toEqual({ loudness: 'quiet', reason: 'bot activity' });
    expect(ruleLoudness(trunkEvent({ ...own, author: 'sol' }, 'bot_comment', 9)).loudness).toBe('quiet');
    // Back in the queue, or merged: the failure needs nobody any more.
    const resubmitted = { ...own, comments: [...own.comments, { ...testing, id: 't3', createdAt: at(20) }] };
    expect(ruleLoudness(trunkEvent(resubmitted, 'bot_comment', 9)).loudness).toBe('quiet');
    expect(ruleLoudness(trunkEvent({ ...own, state: 'MERGED' }, 'bot_comment', 9)).loudness).toBe('quiet');
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

describe('loudness table', () => {
  it('has a row for every kind across the input partitions', () => {
    const kindNames: Record<LoudnessInput['kind'], true> = {
      mention: true, team_mention: true, review_requested: true, review_request_removed: true, reply_to_user: true,
      question_to_user: true, comment: true, review_approved: true, review_changes_requested: true,
      review_commented: true, commits_pushed: true, commits_after_approval: true, force_pushed: true, merged: true,
      merged_without_review: true, closed: true, reopened: true, ready_for_review: true, converted_to_draft: true,
      deploy: true, merge_queue: true, bot_comment: true, comment_edited: true, look_closer: true,
    };
    const kinds = Object.keys(kindNames) as LoudnessInput['kind'][];
    const prs = [makePr(), makePr({ author: viewer.login }), makePr({ isDraft: true }), makePr({ state: 'MERGED' })];
    const gaps: string[] = [];
    for (const kind of kinds) {
      for (const actor of ['', 'viewer', 'bob']) {
        for (const isBot of [false, true]) {
          for (const pr of prs) {
            for (const subject of [null, 'viewer', 'carol', 'acme/team-platform']) {
              for (const flag of [false, true]) {
                const candidate = input({ kind, actor, isBot, pr, subject, userRepliedAfter: flag, requestAnswered: flag });
                if (!findLoudnessRow(candidate)) {
                  gaps.push(`${kind}/${actor}/${isBot}/${subject}/${flag}`);
                }
              }
            }
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});
