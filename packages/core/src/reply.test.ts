import { describe, expect, it } from 'vitest';
import { makeComment, makePr, makeReview, makeThread } from './fixtures.ts';
import { findReactable, quotedReplyBody, replyConversation, replyTarget } from './reply.ts';

describe('quotedReplyBody', () => {
  it('quotes the first line and mentions the author before the text', () => {
    const comment = { author: 'bob', body: 'Why does the cache key include the runner?\n\nIt changes per job.' };
    expect(quotedReplyBody(comment, 'It keeps arm and x86 apart.')).toBe('> Why does the cache key include the runner?\n\n@bob It keeps arm and x86 apart.');
  });

  it('does not mention the author twice when the text already does (any case)', () => {
    const comment = { author: 'Bob', body: 'Can this land today?' };
    expect(quotedReplyBody(comment, 'Yes @bob, after lunch.')).toBe('> Can this land today?\n\nYes @bob, after lunch.');
  });

  it('skips blank and quoted lines when picking the line to quote', () => {
    const comment = { author: 'bob', body: '\n\n> @alice wrote: ship it\n\nNot before the migration runs.' };
    expect(quotedReplyBody(comment, 'Agreed.')).toBe('> Not before the migration runs.\n\n@bob Agreed.');
  });

  it('takes the quote marks off when the comment is only a quote', () => {
    expect(quotedReplyBody({ author: 'bob', body: '>> nested only' }, 'ok')).toBe('> nested only\n\n@bob ok');
  });

  it('clips a long first line to about 200 characters', () => {
    const body = 'x'.repeat(260);
    const reply = quotedReplyBody({ author: 'bob', body }, 'ok');
    const quote = reply.split('\n')[0]!;
    expect(quote).toBe(`> ${'x'.repeat(200)}...`);
  });

  it('sends only the mention and text for an empty comment body', () => {
    expect(quotedReplyBody({ author: 'bob', body: '   ' }, '  thanks  ')).toBe('@bob thanks');
  });
});

describe('replyTarget', () => {
  it('answers an inline comment in its thread, everything else as a quoting comment', () => {
    expect(replyTarget(makeComment({ kind: 'review_comment', threadId: 'T1' }))).toEqual({ kind: 'thread', threadId: 'T1' });
    expect(replyTarget(makeComment({ kind: 'comment' }))).toEqual({ kind: 'comment' });
    expect(replyTarget(makeComment({ kind: 'review' }))).toEqual({ kind: 'comment' });
    expect(replyTarget(makeComment({ kind: 'review_comment', threadId: null }))).toEqual({ kind: 'comment' });
  });
});

describe('findReactable', () => {
  it('finds comments first, then reviews without a body', () => {
    const pr = makePr({ comments: [makeComment({ id: 'IC1' })], reviews: [makeReview({ id: 'R1', body: '' })] });
    expect(findReactable(pr, 'IC1')?.id).toBe('IC1');
    expect(findReactable(pr, 'R1')?.id).toBe('R1');
    expect(findReactable(pr, 'nope')).toBeNull();
  });
});

describe('replyConversation', () => {
  it('is the whole review thread for an inline comment', () => {
    const thread = makeThread('T1', [makeComment({ id: 'RC1', body: 'Why?' }), makeComment({ id: 'RC2', author: 'alice', body: 'Because.' })]);
    const pr = makePr({ threads: [thread], comments: thread.comments });
    expect(replyConversation(pr, thread.comments[0]!).map((c) => c.id)).toEqual(['RC1', 'RC2']);
  });

  it('is the human conversation around a top-level comment, without bots and inline comments', () => {
    const comments = [
      ...Array.from({ length: 12 }, (_, i) => makeComment({ id: `IC${i}` })),
      makeComment({ id: 'BOT', author: 'github-actions[bot]' }),
      makeComment({ id: 'RC1', kind: 'review_comment', threadId: 'T1' }),
    ];
    const pr = makePr({ comments });
    const ids = replyConversation(pr, comments[10]!).map((c) => c.id);
    expect(ids).toEqual(['IC2', 'IC3', 'IC4', 'IC5', 'IC6', 'IC7', 'IC8', 'IC9', 'IC10', 'IC11']);
  });
});
