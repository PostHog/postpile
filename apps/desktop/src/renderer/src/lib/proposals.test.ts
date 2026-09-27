import { describe, expect, it } from 'vitest';
import type { TopicProposal } from '@code-manager/core';
import { at } from '@code-manager/core/fixtures';
import { proposalText } from './proposals.ts';

const names: Record<string, string> = { a: 'Frontend build', b: 'Move CI to Depot' };

function proposal(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p1',
    kind: 'rename',
    topicId: 'a',
    name: null,
    intoTopicId: null,
    fromArea: null,
    prKeys: [],
    reason: '',
    status: 'pending',
    createdAt: at(0),
    decidedAt: null,
    ...overrides,
  };
}

describe('proposalText', () => {
  it('names both topics of a merge', () => {
    const text = proposalText(proposal({ kind: 'merge', intoTopicId: 'b' }), (id) => names[id] ?? id);
    expect(text).toBe('Merge "Frontend build" into "Move CI to Depot"');
  });

  it('names the new name of a rename', () => {
    expect(proposalText(proposal({ name: 'Vite' }), (id) => names[id] ?? id)).toBe('Rename "Frontend build" to "Vite"');
  });

  it('names both areas of an area merge', () => {
    expect(proposalText(proposal({ kind: 'area_merge', topicId: null, name: 'CI', fromArea: 'CI & tests' }), (id) => names[id] ?? id)).toBe(
      'Fold area "CI & tests" into "CI"',
    );
  });
});
