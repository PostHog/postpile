import { describe, expect, it } from 'vitest';
import { tabTitle, unreadTopicCount } from './badge.ts';

describe('the unread badge', () => {
  it('counts topics with an unread tile, not the tiles', () => {
    expect(unreadTopicCount([{ unreadTiles: 3 }, { unreadTiles: 0 }, { unreadTiles: 1 }])).toBe(2);
    expect(unreadTopicCount([])).toBe(0);
  });

  it('puts the count in front of the tab title, and nothing when all is read', () => {
    expect(tabTitle(4)).toBe('(4) PostPile');
    expect(tabTitle(0)).toBe('PostPile');
  });
});
