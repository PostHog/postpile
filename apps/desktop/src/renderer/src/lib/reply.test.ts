import { describe, expect, it } from 'vitest';
import { replyCopy } from './reply.ts';

describe('replyCopy', () => {
  const base = { commentId: 'c1', author: 'alice', canReply: true, viewerReacted: false, asksYou: false };

  it('names the file for a thread reply', () => {
    expect(replyCopy({ ...base, inThread: true, path: '.github/workflows/ci.yml' })).toEqual({
      title: 'Reply in thread',
      hint: 'on ci.yml',
      submit: 'Post reply in thread',
    });
  });

  it('says deleted user for a deleted account', () => {
    expect(replyCopy({ ...base, author: '', inThread: false, path: null }).title).toBe('Reply to deleted user');
  });

  it('names the person for a PR comment', () => {
    expect(replyCopy({ ...base, inThread: false, path: null }).submit).toBe('Post reply to alice');
  });
});
