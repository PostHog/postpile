import { describe, expect, it } from 'vitest';
import type { ActivityLine, PrEvent } from '@postpile/core';
import { makeComment, makeEvent, makePr, makeReview, makeThread } from '@postpile/core/fixtures';
import { replyCopy, replyTargetOf } from './reply.ts';

function line(...events: PrEvent[]): ActivityLine {
  const newest = events[0]!;
  return {
    id: newest.id,
    kind: newest.kind,
    actor: newest.actor,
    summary: newest.summary,
    body: null,
    at: newest.at,
    display: 'loud',
    isNew: false,
    unseen: false,
    events: events.map((event) => ({ event, display: 'loud', unseen: false })),
  };
}

describe('replyTargetOf', () => {
  it('replies to a conversation comment with a new PR comment', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice' })] });
    const target = replyTargetOf(line(makeEvent({ actor: 'alice', sourceId: 'c1' })), pr, 'viewer');
    expect(target).toEqual({ commentId: 'c1', author: 'alice', inThread: false, path: null, canReply: true, viewerReacted: false, asksYou: false });
  });

  it('replies in the thread to a code comment', () => {
    const thread = makeThread('t1', [makeComment({ id: 'rc1', author: 'alice' })]);
    const pr = makePr({ threads: [thread], comments: thread.comments });
    const target = replyTargetOf(line(makeEvent({ actor: 'alice', sourceId: 'rc1' })), pr, 'viewer');
    expect(target?.inThread).toBe(true);
    expect(target?.path).toBe('a.ts');
  });

  it('marks a question to the viewer as asking them', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice' })] });
    const target = replyTargetOf(line(makeEvent({ kind: 'question_to_user', actor: 'alice', sourceId: 'c1' })), pr, 'viewer');
    expect(target?.asksYou).toBe(true);
  });

  it('offers only a reaction on an approval without text', () => {
    const pr = makePr({ reviews: [makeReview({ id: 'r1', author: 'lyra' })] });
    const target = replyTargetOf(line(makeEvent({ kind: 'review_approved', actor: 'lyra', sourceId: 'r1' })), pr, 'viewer');
    expect(target).toMatchObject({ commentId: 'r1', canReply: false });
  });

  it('carries the viewer reaction', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'alice', viewerReacted: true })] });
    expect(replyTargetOf(line(makeEvent({ actor: 'alice', sourceId: 'c1' })), pr, 'viewer')?.viewerReacted).toBe(true);
  });

  it('has nothing for the viewer, bots, pushes or a missing comment', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c1', author: 'viewer' })] });
    expect(replyTargetOf(line(makeEvent({ actor: 'viewer', sourceId: 'c1' })), pr, 'viewer')).toBeNull();
    expect(replyTargetOf(line(makeEvent({ actor: 'ci[bot]', isBot: true, sourceId: 'c1' })), pr, 'viewer')).toBeNull();
    expect(replyTargetOf(line(makeEvent({ kind: 'commits_pushed', actor: 'alice', sourceId: 'head' })), pr, 'viewer')).toBeNull();
    expect(replyTargetOf(line(makeEvent({ actor: 'alice', sourceId: 'gone' })), pr, 'viewer')).toBeNull();
  });
});

describe('replyCopy', () => {
  const base = { commentId: 'c1', author: 'alice', canReply: true, viewerReacted: false, asksYou: false };

  it('names the file for a thread reply', () => {
    expect(replyCopy({ ...base, inThread: true, path: '.github/workflows/ci.yml' })).toEqual({
      title: 'Reply in thread',
      hint: 'on ci.yml',
      submit: 'Post reply in thread',
    });
  });

  it('names the person for a PR comment', () => {
    expect(replyCopy({ ...base, inThread: false, path: null }).submit).toBe('Post reply to alice');
  });
});
