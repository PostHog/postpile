import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.ts';

describe('parseArgs', () => {
  it('parses commands and falls back to help', () => {
    expect(parseArgs(['topics'])).toEqual({ name: 'topics' });
    expect(parseArgs(['pr', 'PostHog/posthog#1'])).toEqual({ name: 'pr', prKey: 'PostHog/posthog#1' });
    expect(parseArgs(['topic'])).toEqual({ name: 'help' });
    expect(parseArgs([])).toEqual({ name: 'help' });
  });
});
