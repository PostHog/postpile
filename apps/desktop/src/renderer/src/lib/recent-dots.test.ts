import { describe, expect, it } from 'vitest';
import { RECENT_DOT_MS, RecentDots } from './recent-dots.ts';

describe('RecentDots', () => {
  it('answers yes once for a dot shown a moment ago', () => {
    const dots = new RecentDots();
    dots.noteShown('tile:acme/app#1', 1000);
    expect(dots.takeRecent('tile:acme/app#1', 1200)).toBe(true);
    expect(dots.takeRecent('tile:acme/app#1', 1300)).toBe(false);
  });

  it('answers no for a dot never noted or shown too long ago', () => {
    const dots = new RecentDots();
    expect(dots.takeRecent('tile:acme/app#1', 1000)).toBe(false);
    dots.noteShown('tile:acme/app#2', 1000);
    expect(dots.takeRecent('tile:acme/app#2', 1000 + RECENT_DOT_MS + 1)).toBe(false);
  });

  it('drops old notes so the record stays small', () => {
    const dots = new RecentDots();
    dots.noteShown('topic:1', 0);
    dots.noteShown('topic:2', 0);
    dots.noteShown('topic:3', RECENT_DOT_MS * 3);
    dots.takeRecent('topic:9', RECENT_DOT_MS * 3);
    expect(dots.size).toBe(1);
  });
});
