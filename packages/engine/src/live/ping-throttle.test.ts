import type { Ping } from '@code-manager/core';
import { describe, expect, it } from 'vitest';
import { PING_TILE_WINDOW_MS, PingThrottle } from './ping-throttle.ts';

function ping(tile: string, title = `about ${tile}`): Ping {
  return { title, body: 'body', target: { topicId: 't', tileId: tile, prKey: `acme/app#${tile}` } };
}

describe('PingThrottle', () => {
  it('shows up to three pings one by one', () => {
    const throttle = new PingThrottle();
    const shown = throttle.plan([ping('1'), ping('2'), ping('3')], 0);
    expect(shown.map((n) => [n.title, n.count])).toEqual([
      ['about 1', 1],
      ['about 2', 1],
      ['about 3', 1],
    ]);
  });

  it('folds more than three into one summary that opens the first', () => {
    const throttle = new PingThrottle();
    const shown = throttle.plan([ping('1'), ping('2'), ping('3'), ping('4'), ping('5')], 0);
    expect(shown).toEqual([
      {
        title: '5 PRs need you',
        body: 'about 1\nabout 2\nabout 3\nand 2 more',
        target: { topicId: 't', tileId: '1', prKey: 'acme/app#1' },
        count: 5,
      },
    ]);
  });

  it('pings a tile at most once per two minutes, also within one cycle', () => {
    const throttle = new PingThrottle();
    expect(throttle.plan([ping('1'), ping('1', 'again')], 0)).toHaveLength(1);
    expect(throttle.plan([ping('1')], PING_TILE_WINDOW_MS - 1)).toEqual([]);
    expect(throttle.plan([ping('1')], PING_TILE_WINDOW_MS)).toHaveLength(1);
  });

  it('counts only pings that pass the window toward the summary', () => {
    const throttle = new PingThrottle();
    throttle.plan([ping('1'), ping('2')], 0);
    const shown = throttle.plan([ping('1'), ping('2'), ping('3'), ping('4')], 1000);
    expect(shown.map((n) => n.title)).toEqual(['about 3', 'about 4']);
  });

  it('falls back to the PR for a ping without a tile', () => {
    const throttle = new PingThrottle();
    const noTile: Ping = { title: 'x', body: '', target: { topicId: null, tileId: null, prKey: 'acme/app#9' } };
    expect(throttle.plan([noTile, noTile], 0)).toHaveLength(1);
  });
});
