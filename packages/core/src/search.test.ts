import { describe, expect, it } from 'vitest';
import { searchTerms, searchTopics, type SearchablePr, type SearchableTopic } from './search.ts';

function pr(key: string, fields: Partial<SearchablePr> = {}): SearchablePr {
  return { key, title: 'Some change', author: 'someone', headRef: 'branch', ...fields };
}

const topics: SearchableTopic[] = [
  {
    topicId: 'depot',
    name: 'Move CI to Depot',
    area: 'CI',
    tiles: [
      { tileId: 'single:a', prs: [pr('acme/app#1902', { title: 'Use Depot cache backend for Turbo', author: 'rowan', headRef: 'rowan/depot-3' })] },
      {
        tileId: 'stack:b',
        prs: [
          pr('acme/app#1851', { title: 'Add project config', author: 'rowan' }),
          pr('acme/app#1911', { title: 'Run e2e', author: 'lyra', headRef: 'lyra/e2e' }),
        ],
      },
    ],
  },
  {
    topicId: 'frontend',
    name: 'Frontend build',
    area: null,
    tiles: [{ tileId: 'single:c', prs: [pr('acme/website#123', { title: 'Speed up Storybook', author: 'jude' })] }],
  },
];

describe('searchTerms', () => {
  it('lowercases and splits on whitespace', () => {
    expect(searchTerms('  Depot   #12 ')).toEqual(['depot', '#12']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('searchTopics', () => {
  it('matches nothing for an empty query', () => {
    expect(searchTopics(topics, '  ').topics).toEqual([]);
  });

  it('matches PR titles case-insensitively', () => {
    expect(searchTopics(topics, 'storybook').topics).toEqual([{ topicId: 'frontend', tileIds: ['single:c'], prKeys: ['acme/website#123'] }]);
  });

  it('matches PR numbers with or without #', () => {
    expect(searchTopics(topics, '#1911').topics[0]?.prKeys).toEqual(['acme/app#1911']);
    expect(searchTopics(topics, '1911').topics[0]?.tileIds).toEqual(['stack:b']);
  });

  it('matches author, repo and head branch', () => {
    expect(searchTopics(topics, 'lyra').topics[0]?.prKeys).toEqual(['acme/app#1911']);
    expect(searchTopics(topics, 'website').topics.map((t) => t.topicId)).toEqual(['frontend']);
    expect(searchTopics(topics, 'depot-3').topics[0]?.tileIds).toEqual(['single:a']);
  });

  it('matches every tile of a topic by its name or area', () => {
    expect(searchTopics(topics, 'depot').topics[0]?.tileIds).toEqual(['single:a', 'stack:b']);
    expect(searchTopics(topics, 'ci').topics.map((t) => t.topicId)).toEqual(['depot']);
  });

  it('needs every term to match (AND), across PR and topic fields', () => {
    const result = searchTopics(topics, 'depot rowan');
    expect(result.topics).toEqual([
      { topicId: 'depot', tileIds: ['single:a', 'stack:b'], prKeys: ['acme/app#1902', 'acme/app#1851'] },
    ]);
    expect(searchTopics(topics, 'rowan storybook').topics).toEqual([]);
  });
});
