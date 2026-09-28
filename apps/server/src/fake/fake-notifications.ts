import type { NotificationThread, PrEvent } from '@postpile/core';
import { SAMPLE_REPO } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

function unseenLoud(events: PrEvent[]): boolean {
  return events.some((event) => !event.seenAt && (event.override?.loudness ?? event.ruleLoudness) === 'loud');
}

/**
 * Sample notification threads for the debug view: one per pinged sample PR
 * (reason from its provenance, unread while it has unseen loud events), plus
 * three that never become tiles so every landing kind shows up.
 */
export function sampleThreads(data: SampleData, now: Date): NotificationThread[] {
  const threads = new Map<string, NotificationThread>();
  for (const tile of data.tiles) {
    for (const member of tile.members) {
      const pr = data.prs.find((candidate) => candidate.key === member.prKey);
      if (member.provenance.kind !== 'pinged' || !pr || threads.has(pr.key)) {
        continue;
      }
      threads.set(pr.key, {
        id: `sample-thread-${pr.ref.number}`,
        reason: member.provenance.reason,
        unread: unseenLoud(data.events.filter((event) => event.prKey === pr.key)),
        updatedAt: pr.updatedAt,
        lastReadAt: null,
        subjectType: 'PullRequest',
        repo: pr.ref.repo,
        number: pr.ref.number,
        title: pr.title,
      });
    }
  }
  const extras: NotificationThread[] = [
    // Old unread threads, so the inbox cleanup line and dialog show in fake mode.
    ...[16, 22, 45].map((days, index): NotificationThread => ({
      id: `sample-thread-old-${days}`,
      reason: index === 1 ? 'mention' : 'subscribed',
      unread: true,
      updatedAt: hoursBefore(now, days * 24),
      lastReadAt: null,
      subjectType: 'Issue',
      repo: SAMPLE_REPO,
      number: 41000 + days,
      title: ['Flaky test tracker (weekly)', 'RFC: move the dev env to Flox', 'Old CI cost report'][index] ?? 'Old thread',
    })),
    {
      id: 'sample-thread-issue-41700',
      reason: 'mention',
      unread: true,
      updatedAt: hoursBefore(now, 3),
      lastReadAt: null,
      subjectType: 'Issue',
      repo: SAMPLE_REPO,
      number: 41700,
      title: 'Flaky Playwright shard on Depot runners',
    },
    {
      id: 'sample-thread-release',
      reason: 'subscribed',
      unread: false,
      updatedAt: hoursBefore(now, 30),
      lastReadAt: hoursBefore(now, 20),
      subjectType: 'Release',
      repo: 'PostHog/posthog-js',
      number: null,
      title: 'posthog-js 1.260.0',
    },
    {
      id: 'sample-thread-41777',
      reason: 'review_requested',
      unread: true,
      updatedAt: hoursBefore(now, 6),
      lastReadAt: null,
      subjectType: 'PullRequest',
      repo: SAMPLE_REPO,
      number: 41777,
      title: 'Split the plugin server test suite',
    },
  ];
  return [...threads.values(), ...extras].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
