import { describe, expect, it } from 'vitest';
import { moveTargets } from './move-targets.ts';
import type { Topic } from './types.ts';
import type { FinishedTopic, TopicListItem } from './views.ts';

function topic(id: string, day: string, people: string[] = []): Pick<TopicListItem, 'topic' | 'people'> {
  return {
    topic: { id, name: `Topic ${id}`, updatedAt: `2026-09-${day}T00:00:00Z` } as Topic,
    people: people.map((login) => ({ login, relation: 'other' as const })),
  };
}

function retired(id: string, name: string): FinishedTopic {
  return { id, name, area: null, retiredAt: '2026-09-01T00:00:00Z', prCount: 1 };
}

const tile = {
  tile: { topicId: 'own' },
  people: [
    { login: 'viewer', role: 'you' as const },
    { login: 'Ada', role: 'author' as const },
  ],
};
const topics = [topic('own', '30', ['ada']), topic('old', '01'), topic('new', '20'), topic('with-ada', '05', ['ada']), topic('with-viewer', '04', ['viewer'])];
const finished = [retired('gone', 'Topic gone')];

describe('moveTargets', () => {
  it('suggests shared people first, then the newest topics, never the tile topic or retired ones', () => {
    const result = moveTargets({ tile, topics, finished, query: '  ', limit: 4 });
    expect(result.from).toBe('suggestion');
    expect(result.targets.map((target) => [target.id, target.reason])).toEqual([
      ['with-ada', 'shared_people'],
      ['new', 'recent'],
      ['with-viewer', 'recent'],
      ['old', 'recent'],
    ]);
  });

  it('filters by name when searching, retired topics last and marked', () => {
    const result = moveTargets({ tile, topics, finished, query: 'GON' });
    expect(result.from).toBe('search');
    expect(result.targets).toEqual([{ id: 'gone', name: 'Topic gone', finished: true, reason: null }]);

    const all = moveTargets({ tile, topics, finished, query: 'topic' });
    expect(all.targets.map((target) => [target.id, target.finished])).toEqual([
      ['new', false],
      ['with-ada', false],
      ['with-viewer', false],
      ['old', false],
      ['gone', true],
    ]);
  });
});
