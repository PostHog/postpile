import { deriveEvents, type EventKind, type Viewer } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { buildSampleData, type SampleData } from './sample-data.ts';

/** Kinds the real engine derives from a comment, a review or a commit: never without a source. */
const SOURCED_KINDS: readonly EventKind[] = [
  'mention',
  'question_to_user',
  'reply_to_user',
  'team_mention',
  'comment',
  'bot_comment',
  'comment_edited',
  'review_approved',
  'review_changes_requested',
  'review_commented',
  'commits_pushed',
  'commits_after_approval',
];

function sampleViewer(data: SampleData): Viewer {
  return { login: data.viewer, teams: data.viewerTeams, homeTeams: data.viewerHomeTeams, teamMembers: data.viewerTeamMembers };
}

/** Testers read the sample as the app: its events must look like the ones the sync writes. */
describe('default sample events read like the engine derives them', () => {
  const data = buildSampleData(new Date('2026-09-27T10:00:00Z'));
  const viewer = sampleViewer(data);

  it("matches deriveEvents' kind, time and summary for every event about a comment, review or commit", () => {
    const mismatches: string[] = [];
    for (const event of data.events) {
      const pr = data.prs.find((candidate) => candidate.key === event.prKey);
      const derived = pr ? deriveEvents(pr, viewer, null).filter((candidate) => candidate.sourceId === event.sourceId) : [];
      if (derived.length === 0) {
        if (SOURCED_KINDS.includes(event.kind) && !event.isBot) {
          mismatches.push(`${event.id}: no comment, review or commit ${event.sourceId}`);
        }
        continue;
      }
      if (!derived.some((candidate) => candidate.kind === event.kind && candidate.summary === event.summary && candidate.at === event.at)) {
        mismatches.push(`${event.id}: ${event.at} "${event.summary}" vs ${derived.map((candidate) => `${candidate.kind} ${candidate.at} "${candidate.summary}"`).join(', ')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('has no review submitted after its PR merged', () => {
    for (const pr of data.prs) {
      for (const review of pr.reviews) {
        expect(pr.mergedAt === null || review.submittedAt <= pr.mergedAt, `${pr.key} ${review.id}`).toBe(true);
      }
    }
  });

  it('words review requests and merges like the timeline summaries', () => {
    for (const event of data.events) {
      if (event.kind === 'review_requested') {
        expect(event.summary).toMatch(/^\S+ requested a review from \S+$/);
      }
      if (event.kind === 'merged' || event.kind === 'merged_without_review') {
        expect(event.summary).toBe(`${event.actor} merged`);
      }
    }
  });
});
