import { effectiveLoudness, type NotificationThread, type PrEvent } from '@postpile/core';
import { sampleQuietReadTimes } from './fake-quiet.ts';
import { SAMPLE_REPO } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

/**
 * GitHub flags a thread for any activity: unread while the PR has an unseen
 * event that is not noise, after PostPile's own quiet mark-read of it if the
 * sample has one.
 */
function hasUnseenActivity(events: PrEvent[], prKey: string, readAt: string | null): boolean {
  return events.some((event) => event.prKey === prKey && event.seenAt === null && effectiveLoudness(event) !== 'muted' && (readAt === null || event.at > readAt));
}

/**
 * Sample notification threads for the tiles and the debug view: one per
 * pinged sample PR (reason from its provenance, unread while it has unseen
 * activity: GitHub unread is PostPile unread), plus a few that never become
 * tiles so every landing kind shows up. The issue and the release are read:
 * PostPile marks notifications that are not PRs read by itself (their
 * "Handled quietly" rows are in fake-quiet.ts).
 */
export function sampleThreads(data: SampleData, now: Date): NotificationThread[] {
  const threads = new Map<string, NotificationThread>();
  const quietReads = sampleQuietReadTimes(now);
  for (const tile of data.tiles) {
    for (const member of tile.members) {
      const pr = data.prs.find((candidate) => candidate.key === member.prKey);
      if (member.provenance.kind !== 'pinged' || !pr || threads.has(pr.key)) {
        continue;
      }
      threads.set(pr.key, {
        id: `sample-thread-${pr.ref.number}`,
        reason: member.provenance.reason,
        unread: hasUnseenActivity(data.events, pr.key, quietReads.get(pr.key) ?? null),
        updatedAt: pr.updatedAt,
        lastReadAt: quietReads.get(pr.key) ?? null,
        subjectType: 'PullRequest',
        repo: pr.ref.repo,
        number: pr.ref.number,
        title: pr.title,
      });
    }
  }
  const extras: NotificationThread[] = [
    // Old unread PR threads the sync never fetches, so the inbox cleanup line and dialog show in fake mode.
    ...[16, 22, 45].map((days, index): NotificationThread => ({
      id: `sample-thread-old-${days}`,
      reason: index === 1 ? 'mention' : 'subscribed',
      unread: true,
      updatedAt: hoursBefore(now, days * 24),
      lastReadAt: null,
      subjectType: 'PullRequest',
      repo: SAMPLE_REPO,
      number: 1000 + days,
      title: ['Flaky test tracker (weekly)', 'RFC: move the dev env to Flox', 'Old CI cost report'][index] ?? 'Old thread',
    })),
    {
      id: 'sample-thread-issue-1700',
      reason: 'mention',
      unread: false,
      updatedAt: hoursBefore(now, 3),
      lastReadAt: hoursBefore(now, 2.5),
      subjectType: 'Issue',
      repo: SAMPLE_REPO,
      number: 1700,
      title: 'Flaky Playwright shard on Depot runners',
    },
    {
      id: 'sample-thread-release',
      reason: 'subscribed',
      unread: false,
      updatedAt: hoursBefore(now, 30),
      lastReadAt: hoursBefore(now, 20),
      subjectType: 'Release',
      repo: 'acme/web-sdk',
      number: null,
      title: 'web-sdk 1.260.0',
    },
    {
      id: 'sample-thread-1777',
      reason: 'review_requested',
      unread: true,
      updatedAt: hoursBefore(now, 6),
      lastReadAt: null,
      subjectType: 'PullRequest',
      repo: SAMPLE_REPO,
      number: 1777,
      title: 'Split the plugin server test suite',
    },
  ];
  return [...threads.values(), ...extras].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
