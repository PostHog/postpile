import { describe, expect, it } from 'vitest';
import { boardShapeEvents } from './board-shape.ts';
import type { Tile, TileMember, Topic } from './types.ts';

function topic(id: string, status: Topic['status'] = 'active'): Topic {
  return {
    id,
    name: id,
    summary: '',
    summaryInputHash: null,
    tailoring: '',
    driver: null,
    userRole: 'watcher',
    status,
    retiredAt: null,
    area: null,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
  };
}

function member(prKey: string, pulledIn = false): TileMember {
  return {
    prKey,
    provenance: pulledIn ? { kind: 'pulled_in', reason: 'stack layer below' } : { kind: 'pinged', reason: 'review_requested' },
  } as TileMember;
}

function tile(kind: Tile['kind'], members: TileMember[], stacks: string[][]): Tile {
  return {
    id: `${kind}:${members[0]?.prKey}`,
    topicId: 't1',
    kind,
    title: '',
    members,
    stacks: stacks.map((prKeys) => ({ id: `stack:${prKeys[0]}`, prKeys })),
  };
}

describe('boardShapeEvents', () => {
  const single = tile('single', [member('a/b#1')], []);
  const stack = tile('stack', [member('a/b#2'), member('a/b#3', true)], [['a/b#2', 'a/b#3']]);
  const set = tile('set', [member('a/b#4'), member('a/b#5'), member('a/b#6')], [['a/b#4', 'a/b#5']]);

  it('counts a single, a stack and a set holding a stack, per tile and per topic', () => {
    const events = boardShapeEvents([{ topic: topic('t1'), tiles: [single, stack, set] }]);
    expect(events.map((event) => event.props)).toEqual([
      { kind: 'single', prs: 1, stacked_prs: 0, pulled_in: 0, topic_tiles: 3 },
      { kind: 'stack', prs: 2, stacked_prs: 2, pulled_in: 1, topic_tiles: 3 },
      { kind: 'set', prs: 3, stacked_prs: 2, pulled_in: 0, topic_tiles: 3 },
      { tiles: 3, prs: 6, single_tiles: 1, stack_tiles: 1, set_tiles: 1 },
    ]);
  });

  it('skips retired topics', () => {
    expect(boardShapeEvents([{ topic: topic('t1', 'retired'), tiles: [single] }])).toEqual([]);
  });
});
