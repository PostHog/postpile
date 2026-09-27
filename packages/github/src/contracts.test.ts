import { describe, expect, it } from 'vitest';
import { PR_BATCH_SIZE, type GitHubWriter } from './index.ts';

describe('github contracts', () => {
  it('keeps writes behind a separate interface', () => {
    const calls: string[] = [];
    const writer: GitHubWriter = {
      markThreadRead: async (id) => void calls.push(`read:${id}`),
      approvePr: async (ref) => void calls.push(`approve:${ref.repo}#${ref.number}`),
      commentOnPr: async (ref) => void calls.push(`comment:${ref.repo}#${ref.number}`),
    };
    void writer.markThreadRead('1');
    expect(calls).toEqual(['read:1']);
    expect(PR_BATCH_SIZE).toBe(12);
  });
});
