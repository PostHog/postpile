import { describe, expect, it } from 'vitest';
import { parseArgs, parseInvocation, withCallCap } from './args.ts';

describe('parseArgs', () => {
  it('parses commands and falls back to help', () => {
    expect(parseArgs(['topics'])).toEqual({ name: 'topics' });
    expect(parseArgs(['poll'])).toEqual({ name: 'poll' });
    expect(parseArgs(['poll', '--now'])).toEqual({ name: 'help' });
    expect(parseArgs(['sweep'])).toEqual({ name: 'sweep' });
    expect(parseArgs(['setup-draft'])).toEqual({ name: 'setup-draft' });
    expect(parseArgs(['pr', 'PostHog/posthog#1'])).toEqual({ name: 'pr', prKey: 'PostHog/posthog#1' });
    expect(parseArgs(['topic'])).toEqual({ name: 'help' });
    expect(parseArgs([])).toEqual({ name: 'help' });
  });

  it('parses sync flags', () => {
    expect(parseArgs(['sync'])).toEqual({ name: 'sync', options: {} });
    expect(parseArgs(['sync', '--limit', '10', '--no-agent'])).toEqual({
      name: 'sync',
      options: { maxPrs: 10, maxAgentCalls: 0 },
    });
    expect(parseArgs(['sync', '--max-agent-calls', '1', '--agent-jobs', 'glances'])).toEqual({
      name: 'sync',
      options: { maxAgentCalls: 1, agentJobs: ['glances'] },
    });
  });

  it('parses consolidate flags', () => {
    expect(parseArgs(['consolidate'])).toEqual({ name: 'consolidate', options: {} });
    expect(parseArgs(['consolidate', '--if-due', '--max-agent-calls', '2'])).toEqual({
      name: 'consolidate',
      options: { onlyIfDue: true, maxAgentCalls: 2 },
    });
    expect(parseArgs(['consolidate', '--now'])).toEqual({ name: 'help' });
  });

  it('rejects bad sync flags', () => {
    expect(parseArgs(['sync', '--limit', '0'])).toEqual({ name: 'help' });
    expect(parseArgs(['sync', '--agent-jobs', 'nope'])).toEqual({ name: 'help' });
    expect(parseArgs(['sync', '--agent-jobs', 'summaries'])).toEqual({ name: 'help' });
    expect(parseArgs(['sync', '--what'])).toEqual({ name: 'help' });
  });
});

describe('parseInvocation', () => {
  it('takes --read-only for read commands only', () => {
    expect(parseInvocation(['topics', '--read-only'])).toEqual({ command: { name: 'topics' }, readOnly: true, error: null });
    expect(parseInvocation(['pr', 'a/b#1'])).toMatchObject({ readOnly: false, error: null });
    expect(parseInvocation(['sync', '--read-only']).error).toBe('--read-only only works with topics, topic and pr, not sync');
    expect(parseInvocation(['poll', '--read-only']).error).toMatch(/not poll/);
  });
});

describe('withCallCap', () => {
  it('caps sync and consolidate without a flag, keeps an explicit cap', () => {
    expect(withCallCap(parseArgs(['sync']), 7)).toEqual({ name: 'sync', options: { maxAgentCalls: 7 } });
    expect(withCallCap(parseArgs(['sync', '--no-agent']), 7)).toEqual({ name: 'sync', options: { maxAgentCalls: 0 } });
    expect(withCallCap(parseArgs(['consolidate']), 7)).toEqual({ name: 'consolidate', options: { maxAgentCalls: 7 } });
    expect(withCallCap(parseArgs(['consolidate', '--max-agent-calls', '3']), 7)).toEqual({ name: 'consolidate', options: { maxAgentCalls: 3 } });
    expect(withCallCap(parseArgs(['topics']), 7)).toEqual({ name: 'topics' });
  });
});
