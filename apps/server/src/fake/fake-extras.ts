import { addMcpPack } from './fake-mcp-pack.ts';
import type { SampleClock } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

/**
 * Opt-in sample packs (POSTPILE_FAKE_EXTRA, comma separated): extra topics,
 * PRs and states the default sample never shows, for UI checks. The default
 * sample stays as it is, so tests and README screenshots keep their numbers.
 */
export type FakeExtra = 'board' | 'stacks' | 'pane' | 'stress' | 'calm' | 'mcp';

const KNOWN_EXTRAS: FakeExtra[] = ['board', 'stacks', 'pane', 'stress', 'calm', 'mcp'];

function isFakeExtra(word: string): word is FakeExtra {
  return (KNOWN_EXTRAS as string[]).includes(word);
}

/** The packs named in POSTPILE_FAKE_EXTRA; unknown words are ignored. */
export function fakeExtras(value: string | undefined): Set<FakeExtra> {
  const words = (value ?? '').split(',').map((word) => word.trim().toLowerCase());
  return new Set(words.filter(isFakeExtra));
}

/** Adds each asked-for pack to the sample, after the default topics and PRs. */
export function addFakeExtras(data: SampleData, clock: SampleClock, extras: Set<FakeExtra>): void {
  // Each pack adds its topics, PRs, events, glances, tiles and membership here.
  if (extras.has('mcp')) {
    addMcpPack(data, clock);
  }
}
