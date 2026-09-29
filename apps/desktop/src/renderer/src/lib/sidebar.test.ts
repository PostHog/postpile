import { describe, expect, it } from 'vitest';
import type { Topic, TopicListItem, TopicPlacement } from '@postpile/core';
import { sidebarGroups } from './sidebar.ts';

function topic(id: string): Topic {
  const at = '2026-09-27T00:00:00.000Z';
  return { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', area: null, createdAt: at, updatedAt: at };
}

function item(id: string, unreadTiles: number, placement: Partial<TopicPlacement> | null): TopicListItem {
  return {
    topic: topic(id),
    placement: placement === null ? null : { relation: 'team', ownerTeam: null, whyYou: '', area: null, corrected: false, ...placement },
    statusLine: null,
    group: unreadTiles > 0 ? 'needs_you' : 'quiet',
    unreadTiles,
    urgentUnreadTiles: unreadTiles,
    openTiles: 0,
    totalTiles: 1,
    yourMoves: [], unseenMergeTiles: 0,
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 1 }, byYou: 0, byTeam: 0, changesAddressed: 0 },
    people: [],
  };
}

describe('sidebarGroups', () => {
  it('puts unread topics first, then the rest by relation and team topics by area', () => {
    const groups = sidebarGroups([
      item('depot', 2, { relation: 'team', area: 'CI' }),
      item('rfc', 1, { relation: 'routed', area: 'CI' }),
      item('ci', 0, { relation: 'team', area: 'CI' }),
      item('devbox', 0, { relation: 'team', area: 'Dev env' }),
      item('new', 0, null),
      item('frontend', 0, { relation: 'routed' }),
      item('desktop', 0, { relation: 'fyi' }),
    ]);

    expect(groups.needsYou.map((entry) => entry.topic.id)).toEqual(['depot', 'rfc']);
    expect(groups.team.map((group) => [group.area, group.items.map((entry) => entry.topic.id)])).toEqual([
      ['CI', ['ci']],
      ['Dev env', ['devbox']],
      ['Other', ['new']],
    ]);
    expect(groups.routed.map((entry) => entry.topic.id)).toEqual(['frontend']);
    expect(groups.fyi.map((entry) => entry.topic.id)).toEqual(['desktop']);
  });
});
