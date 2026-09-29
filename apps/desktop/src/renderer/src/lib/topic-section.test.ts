import { describe, expect, it } from 'vitest';
import type { TopicQueues } from '@postpile/core';
import { emptyTierCounts } from '@postpile/core';
import { topicTelemetrySection } from './topic-section.ts';

function queues(overrides: Partial<Record<keyof TopicQueues['tiers'], number>>): TopicQueues {
  return { tiers: { ...emptyTierCounts(), ...overrides }, byYou: 0, byTeam: 0, changesAddressed: 0 };
}

describe('topicTelemetrySection', () => {
  it('picks the highest-priority non-empty tier', () => {
    expect(topicTelemetrySection(queues({ needs_reply: 1, mine: 2 }))).toBe('needs_reply');
    expect(topicTelemetrySection(queues({ changes_requested: 1, mine: 2 }))).toBe('changes_requested');
    expect(topicTelemetrySection(queues({ mine: 1, team: 1 }))).toBe('my_prs');
    expect(topicTelemetrySection(queues({ team: 1 }))).toBe('team_prs');
    expect(topicTelemetrySection(queues({ to_review: 1 }))).toBe('to_review');
    expect(topicTelemetrySection(queues({ team_mentioned: 1 }))).toBe('team_mentioned');
  });

  it('is "other" when only rest has PRs, or nothing does', () => {
    expect(topicTelemetrySection(queues({ rest: 3 }))).toBe('other');
    expect(topicTelemetrySection(queues({}))).toBe('other');
  });
});
