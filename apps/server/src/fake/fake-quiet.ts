import { quietReadDetail, type NewActionLogEntry, type PingDecision } from '@postpile/core';
import { SAMPLE_REPO } from './sample-builders.ts';

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

/** Sample PRs whose read threads came back only because of bots, and which bots. Invented. */
const QUIET_SAMPLES: { number: number; bots: string[]; hoursAgo: number }[] = [
  { number: 1904, bots: ['trunk-io[bot]', 'CI'], hoursAgo: 2 },
  { number: 1899, bots: ['github-actions[bot]'], hoursAgo: 26 },
  { number: 1921, bots: ['renovate[bot]', 'CI'], hoursAgo: 50 },
  { number: 1963, bots: ['chatgpt-codex-connector[bot]', 'coderabbitai[bot]'], hoursAgo: 75 },
  // Older than the view's 7 days: in the log, not in "Handled quietly".
  { number: 1855, bots: ['vercel[bot]'], hoursAgo: 9 * 24 },
];

/**
 * Action log rows as the real sync writes them for "Handled quietly", on
 * sample threads that are read. Oldest first, so the log ids grow with time.
 */
export function sampleQuietReads(now: Date): NewActionLogEntry[] {
  return QUIET_SAMPLES.toSorted((a, b) => b.hoursAgo - a.hoursAgo).map((sample) => ({
    at: hoursBefore(now, sample.hoursAgo),
    action: 'mark_read',
    origin: 'quiet',
    outcome: 'github',
    threadId: `sample-thread-${sample.number}`,
    prKey: `${SAMPLE_REPO}#${sample.number}`,
    tileId: null,
    batch: null,
    detail: quietReadDetail(sample.bots),
  }));
}

/** Ping decisions of the live poll on sample threads: pinged and withheld, by the rules, the agent and the fallback. Invented. */
export function samplePingDecisions(now: Date): PingDecision[] {
  const decision = (number: number, hoursAgo: number, fields: Pick<PingDecision, 'ping' | 'source' | 'reason'> & Partial<PingDecision>): PingDecision => ({
    threadId: `sample-thread-${number}`,
    prKey: `${SAMPLE_REPO}#${number}`,
    title: '',
    body: '',
    at: hoursBefore(now, hoursAgo),
    ...fields,
  });
  return [
    decision(1907, 1, {
      ping: true,
      source: 'agent',
      title: 'lyra asks about the cache salt',
      body: 'She wants your OK before dropping the per-job salt.',
      reason: 'asks you directly and waits on your answer',
    }),
    decision(1902, 3, { ping: false, source: 'agent', reason: 'the mention is an FYI; the push only touches config you already reviewed' }),
    decision(1902, 5, { ping: false, source: 'rules', reason: 'not_addressed: comment on a PR you review, not aimed at you' }),
    decision(1911, 0.5, { ping: false, source: 'rules', reason: 'bot: only bot activity' }),
    decision(1822, 8, {
      ping: true,
      source: 'fallback',
      title: '@remy asked you something · app#1822',
      body: 'Can you check the timing data split?',
      reason: 'agent call failed; rules: question to you',
    }),
  ];
}
