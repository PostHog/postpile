// Back / forward navigation, like a browser: every user navigation pushes an
// entry, back and forward move through them, and a new navigation after going
// back drops the forward entries.

/** What the middle pane shows. */
export type Pane = 'topic' | 'inbox' | 'instructions' | 'notifications' | 'quiet';

/**
 * One place the user went. Null ids mean "not picked": the app falls back to
 * the first topic, its first tile and that tile's lead PR.
 */
export interface NavEntry {
  pane: Pane;
  topicId: string | null;
  tileId: string | null;
  prKey: string | null;
}

export interface NavHistory {
  entries: NavEntry[];
  index: number;
}

/** Entries kept at most; the oldest drop off first. */
export const MAX_ENTRIES = 100;

const START_ENTRY: NavEntry = { pane: 'topic', topicId: null, tileId: null, prKey: null };

export function startHistory(): NavHistory {
  return { entries: [START_ENTRY], index: 0 };
}

export function currentEntry(history: NavHistory): NavEntry {
  return history.entries[history.index] ?? START_ENTRY;
}

/**
 * True when `next` would show what `shown` already shows. A topic pick
 * without a tile (tileId null) is the same as the topic with any tile open,
 * so picking the current topic again does not add an entry.
 */
export function sameView(shown: NavEntry, next: NavEntry): boolean {
  if (shown.pane !== next.pane) {
    return false;
  }
  if (next.pane !== 'topic') {
    return true;
  }
  if (shown.topicId !== next.topicId) {
    return false;
  }
  return next.tileId === null || (shown.tileId === next.tileId && shown.prKey === next.prKey);
}

/** Pushes `entry` after the current one, dropping forward entries. A repeat of the current entry is ignored. */
export function navigate(history: NavHistory, entry: NavEntry): NavHistory {
  if (sameView(currentEntry(history), entry)) {
    return history;
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

/** Swaps the current entry for `entry`, no new history entry. */
export function replaceCurrent(history: NavHistory, entry: NavEntry): NavHistory {
  const entries = history.entries.map((candidate, index) => (index === history.index ? entry : candidate));
  return { ...history, entries };
}

/**
 * The current entry with the app's fallbacks written in (the first topic,
 * the grid's first tile, its PR), so a later reorder or refetch does not
 * move what is on screen. Null when there is nothing to pin: another pane,
 * no topic yet, or the entry already says it. Before the tiles load
 * (`shown.tileId` null) only the topic is pinned.
 */
export function pinnedEntry(current: NavEntry, shown: NavEntry): NavEntry | null {
  if (current.pane !== 'topic' || shown.topicId === null) {
    return null;
  }
  const tileKnown = shown.tileId !== null;
  const next: NavEntry = {
    pane: 'topic',
    topicId: shown.topicId,
    tileId: tileKnown ? shown.tileId : current.tileId,
    prKey: tileKnown ? shown.prKey : current.prKey,
  };
  const same = next.topicId === current.topicId && next.tileId === current.tileId && next.prKey === current.prKey;
  return same ? null : next;
}

/**
 * Index of the nearest usable entry in `step` direction (-1 back, +1
 * forward), or null. Entries whose topic is gone are skipped.
 */
function stepIndex(history: NavHistory, step: -1 | 1, usable: (entry: NavEntry) => boolean): number | null {
  for (let index = history.index + step; index >= 0 && index < history.entries.length; index += step) {
    const entry = history.entries[index];
    if (entry && usable(entry)) {
      return index;
    }
  }
  return null;
}

export function canGoBack(history: NavHistory, usable: (entry: NavEntry) => boolean): boolean {
  return stepIndex(history, -1, usable) !== null;
}

export function canGoForward(history: NavHistory, usable: (entry: NavEntry) => boolean): boolean {
  return stepIndex(history, 1, usable) !== null;
}

export function goBack(history: NavHistory, usable: (entry: NavEntry) => boolean): NavHistory {
  const index = stepIndex(history, -1, usable);
  return index === null ? history : { ...history, index };
}

export function goForward(history: NavHistory, usable: (entry: NavEntry) => boolean): NavHistory {
  const index = stepIndex(history, 1, usable);
  return index === null ? history : { ...history, index };
}

/**
 * An entry can be shown when it is not a topic view or its topic still
 * exists. A topic-less entry (the start) always works through the fallback.
 * Tiles are not checked here: a missing tile falls back to the topic's first.
 */
export function entryUsable(entry: NavEntry, topicIds: ReadonlySet<string>): boolean {
  return entry.pane !== 'topic' || entry.topicId === null || topicIds.has(entry.topicId);
}
