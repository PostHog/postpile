import { describe, expect, it } from 'vitest';
import type { TopicProposal } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { proposalMeta, proposalText, suggestedBy } from './proposals.ts';

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
    source: 'consolidation',
    client: null,
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

  it('counts the PRs of a move and names both topics', () => {
    expect(proposalText(proposal({ kind: 'move', intoTopicId: 'b', prKeys: ['acme/app#1', 'acme/app#2'] }), (id) => names[id] ?? id)).toBe(
      'Move 2 PRs from "Frontend build" into "Move CI to Depot"',
    );
    expect(proposalText(proposal({ kind: 'move', intoTopicId: 'b', prKeys: ['acme/app#1'] }), (id) => names[id] ?? id)).toBe('Move 1 PR from "Frontend build" into "Move CI to Depot"');
  });

  it('names both areas of an area merge', () => {
    expect(proposalText(proposal({ kind: 'area_merge', topicId: null, name: 'CI', fromArea: 'CI & tests' }), (id) => names[id] ?? id)).toBe(
      'Fold area "CI & tests" into "CI"',
    );
  });
});

describe('suggestedBy', () => {
  it('names known outside agents and falls back for unknown ones', () => {
    expect(suggestedBy(proposal({ source: 'agent', client: 'claude-code' }))).toBe('Claude Code');
    expect(suggestedBy(proposal({ source: 'agent', client: 'some-tool' }))).toBe('an outside agent');
    expect(suggestedBy(proposal({ source: 'agent', client: 'constructor' }))).toBe('an outside agent');
    expect(suggestedBy(proposal({ source: 'agent', client: null }))).toBe('an outside agent');
    expect(suggestedBy(proposal({}))).toBeNull();
  });

  it('puts the suggester in the card meta line only for outside proposals', () => {
    expect(proposalMeta(proposal({ source: 'agent', client: 'claude-code' }), '2h')).toBe('topic · suggested by Claude Code · 2h');
    expect(proposalMeta(proposal({}), '2h')).toBe('topic · 2h');
  });
});
