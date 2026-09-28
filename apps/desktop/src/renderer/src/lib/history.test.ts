import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  canGoForward,
  currentEntry,
  entryUsable,
  goBack,
  goForward,
  MAX_ENTRIES,
  navigate,
  pinnedEntry,
  replaceCurrent,
  sameView,
  startHistory,
  type NavEntry,
} from './history.ts';

function topic(topicId: string, tileId: string | null = null, prKey: string | null = null): NavEntry {
  return { pane: 'topic', topicId, tileId, prKey };
}

const inbox: NavEntry = { pane: 'inbox', topicId: null, tileId: null, prKey: null };
const always = () => true;

describe('navigate', () => {
  it('pushes entries and moves to the newest', () => {
    const history = navigate(navigate(startHistory(), topic('a')), topic('b'));
    expect(history.entries).toHaveLength(3);
    expect(currentEntry(history)).toEqual(topic('b'));
  });

  it('ignores picking the same thing again', () => {
    const once = navigate(startHistory(), topic('a', 't1', 'pr1'));
    expect(navigate(once, topic('a', 't1', 'pr1'))).toBe(once);
    expect(navigate(once, topic('a'))).toBe(once);
    const inInbox = navigate(once, inbox);
    expect(navigate(inInbox, inbox)).toBe(inInbox);
  });

  it('pushes another PR in the same tile', () => {
    const history = navigate(navigate(startHistory(), topic('a', 't1', 'pr1')), topic('a', 't1', 'pr2'));
    expect(history.entries).toHaveLength(3);
  });

  it('drops forward entries after going back', () => {
    let history = navigate(navigate(startHistory(), topic('a')), topic('b'));
    history = goBack(history, always);
    history = navigate(history, topic('c'));
    expect(history.entries.map((entry) => entry.topicId)).toEqual([null, 'a', 'c']);
    expect(canGoForward(history, always)).toBe(false);
  });

  it('keeps at most MAX_ENTRIES', () => {
    let history = startHistory();
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      history = navigate(history, topic(`t${i}`));
    }
    expect(history.entries).toHaveLength(MAX_ENTRIES);
    expect(currentEntry(history)).toEqual(topic(`t${MAX_ENTRIES + 9}`));
  });
});

describe('back and forward', () => {
  it('moves like a browser', () => {
    let history = navigate(navigate(startHistory(), topic('a')), inbox);
    expect(canGoBack(history, always)).toBe(true);
    expect(canGoForward(history, always)).toBe(false);
    history = goBack(history, always);
    expect(currentEntry(history)).toEqual(topic('a'));
    history = goForward(history, always);
    expect(currentEntry(history)).toEqual(inbox);
  });

  it('stays put at either end', () => {
    const history = startHistory();
    expect(canGoBack(history, always)).toBe(false);
    expect(goBack(history, always)).toBe(history);
    expect(goForward(history, always)).toBe(history);
  });

  it('skips entries whose topic is gone', () => {
    let history = navigate(navigate(navigate(startHistory(), topic('a')), topic('gone')), topic('b'));
    const usable = (entry: NavEntry) => entryUsable(entry, new Set(['a', 'b']));
    history = goBack(history, usable);
    expect(currentEntry(history)).toEqual(topic('a'));
    history = goForward(history, usable);
    expect(currentEntry(history)).toEqual(topic('b'));
  });

  it('cannot go back when only gone topics are behind', () => {
    const history = navigate(navigate({ entries: [topic('gone')], index: 0 }, topic('also-gone')), topic('b'));
    const usable = (entry: NavEntry) => entryUsable(entry, new Set(['b']));
    expect(canGoBack(history, usable)).toBe(false);
  });
});

describe('sameView', () => {
  it('compares panes, then topic, tile and PR', () => {
    expect(sameView(inbox, inbox)).toBe(true);
    expect(sameView(inbox, topic('a'))).toBe(false);
    expect(sameView(topic('a', 't1', 'pr1'), topic('a'))).toBe(true);
    expect(sameView(topic('a', 't1', 'pr1'), topic('a', 't2', 'pr1'))).toBe(false);
    expect(sameView(topic('a'), topic('b'))).toBe(false);
  });
});

describe('entryUsable', () => {
  it('accepts non-topic panes and the topic-less start', () => {
    const none = new Set<string>();
    expect(entryUsable(inbox, none)).toBe(true);
    expect(entryUsable(startHistory().entries[0]!, none)).toBe(true);
    expect(entryUsable(topic('a'), none)).toBe(false);
  });
});

describe('replaceCurrent', () => {
  it('swaps the current entry without adding one', () => {
    const history = navigate(navigate(startHistory(), topic('a')), topic('b'));
    const replaced = replaceCurrent(history, topic('b', 'tile-1', 'pr-1'));
    expect(replaced.entries).toHaveLength(3);
    expect(replaced.index).toBe(2);
    expect(currentEntry(replaced)).toEqual(topic('b', 'tile-1', 'pr-1'));
  });
});

describe('pinnedEntry', () => {
  it('writes the fallback topic, tile and PR into an unpicked entry', () => {
    const start = { pane: 'topic' as const, topicId: null, tileId: null, prKey: null };
    expect(pinnedEntry(start, topic('a'))).toEqual(topic('a'));
    expect(pinnedEntry(topic('a'), topic('a', 'tile-1', 'pr-1'))).toEqual(topic('a', 'tile-1', 'pr-1'));
  });

  it('pins nothing when the entry already says it, or on another pane', () => {
    expect(pinnedEntry(topic('a', 'tile-1', 'pr-1'), topic('a', 'tile-1', 'pr-1'))).toBeNull();
    expect(pinnedEntry(inbox, topic('a', 'tile-1', 'pr-1'))).toBeNull();
    expect(pinnedEntry(topic('a'), topic('a'))).toBeNull();
  });
});
