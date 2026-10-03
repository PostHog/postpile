import { judgedReadDetail, quietReadDetail, quietReasonDetail, type NewActionLogEntry, type PingDecision } from '@postpile/core';
import { SAMPLE_REPO } from './sample-builders.ts';

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

/**
 * Sample PRs PostPile marked read by itself, with the log detail: threads
 * that came back only because of bots (which bots), threads the viewer
 * reviewed after everything unread, and threads where a teammate's comment
 * since the viewer last looked was judged as not needing them. Invented.
 */
const QUIET_SAMPLES: { number: number; detail: string; hoursAgo: number }[] = [
  { number: 1904, detail: quietReadDetail(['trunk-io[bot]', 'CI']), hoursAgo: 2 },
  { number: 1911, detail: quietReasonDetail('approved'), hoursAgo: 3.5 },
  { number: 1934, detail: judgedReadDetail(['lyra', 'CI']), hoursAgo: 4 },
  // After mergify queued it (1h ago): the tile is done again.
  { number: 1899, detail: quietReadDetail(['renovate[bot]', 'mergify[bot]']), hoursAgo: 0.5 },
  { number: 1960, detail: quietReasonDetail('changes_requested'), hoursAgo: 29 },
  { number: 1921, detail: quietReadDetail(['renovate[bot]', 'CI']), hoursAgo: 50 },
  { number: 1963, detail: quietReadDetail(['chatgpt-codex-connector[bot]', 'coderabbitai[bot]']), hoursAgo: 75 },
  // Older than the view's 7 days: in the log, not in "Handled quietly".
  { number: 1855, detail: quietReadDetail(['vercel[bot]']), hoursAgo: 9 * 24 },
];

/** When PostPile marked each sample PR's thread read by itself, by PR: its thread stays read unless something came after. */
export function sampleQuietReadTimes(now: Date): Map<string, string> {
  return new Map(QUIET_SAMPLES.map((sample) => [`${SAMPLE_REPO}#${sample.number}`, hoursBefore(now, sample.hoursAgo)]));
}

/**
 * Action log rows as the real sync writes them for "Handled quietly", on
 * sample threads that are read. Oldest first, so the log ids grow with time.
 */
export function sampleQuietReads(now: Date): NewActionLogEntry[] {
  const rows = QUIET_SAMPLES.map((sample) => ({ hoursAgo: sample.hoursAgo, threadId: `sample-thread-${sample.number}`, prKey: `${SAMPLE_REPO}#${sample.number}`, detail: sample.detail }));
  return rows.toSorted((a, b) => b.hoursAgo - a.hoursAgo).map((row) => ({
    at: hoursBefore(now, row.hoursAgo),
    action: 'mark_read',
    origin: 'quiet',
    outcome: 'github',
    threadId: row.threadId,
    prKey: row.prKey,
    tileId: null,
    batch: null,
    detail: row.detail,
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
