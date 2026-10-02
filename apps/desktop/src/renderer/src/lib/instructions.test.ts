import { describe, expect, it } from 'vitest';
import type { InstructionsProposal } from '@postpile/core';
import { proposalKey } from './instructions.ts';

const BASE: InstructionsProposal = {
  baseVersion: 3,
  baseText: '',
  text: '- Skip docs-only PRs\n',
  summary: 'Added: Skip docs-only PRs',
  sourceChatMessageId: 12,
  sourceLessonId: null,
  dossiersToRefresh: 0,
};

describe('proposalKey', () => {
  it('keys by the one source, so a chat message and a lesson with the same id never collide', () => {
    expect(proposalKey(BASE)).toBe('chat:12');
    expect(proposalKey({ ...BASE, sourceChatMessageId: null, sourceLessonId: 12 })).toBe('lesson:12');
  });
});
