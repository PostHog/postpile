import { deriveEvents, quietReadCheck, touchedReadCheck, type Pr } from '@postpile/core';
import { viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './fake-fetch.ts';
import { toPr } from './normalize.ts';
import type { RawBatchResponse, RawPullRequest } from './raw.ts';

const ref = { repo: 'acme/app', number: 42 };

/** A fresh copy of the fixture's open PR, to change per test. */
function rawPr(): RawPullRequest {
  const batch = loadFixture('pr-batch.json') as { data: RawBatchResponse };
  const pr = batch.data.p0?.pullRequest;
  if (!pr) {
    throw new Error('fixture p0 is missing');
  }
  return structuredClone(pr);
}

function pendingReview(body: string): RawPullRequest['reviews']['nodes'][number] {
  return {
    id: 'RP',
    state: 'PENDING',
    url: 'https://github.com/acme/app/pull/42#pullrequestreview-9',
    submittedAt: null,
    createdAt: '2026-09-19T13:00:00Z',
    author: { __typename: 'User', login: 'viewer' },
    body,
    commit: { oid: 'c2' },
  };
}

describe('toPr: pending reviews', () => {
  it('leaves a pending review body out of the comments', () => {
    const raw = rawPr();
    raw.reviews.nodes.push(pendingReview('Sure, looking now'));
    const pr = toPr(ref, raw);
    expect(pr.comments.map((c) => c.id)).not.toContain('RP');
    expect(pr.reviews.find((r) => r.id === 'RP')?.state).toBe('PENDING');
  });

  it('drops pending inline comments, and a thread holding only drafts', () => {
    const raw = rawPr();
    const thread = raw.reviewThreads.nodes[0];
    if (!thread) {
      throw new Error('fixture thread is missing');
    }
    thread.comments.nodes.push({
      id: 'RC2',
      url: 'https://github.com/acme/app/pull/42#discussion_r2',
      author: { __typename: 'User', login: 'viewer' },
      body: 'Draft answer',
      createdAt: '2026-09-19T13:01:00Z',
      state: 'PENDING',
    });
    raw.reviewThreads.nodes.push({
      id: 'T2',
      path: 'ci.yml',
      isResolved: false,
      comments: {
        nodes: [
          {
            id: 'RC3',
            url: 'https://github.com/acme/app/pull/42#discussion_r3',
            author: { __typename: 'User', login: 'viewer' },
            body: 'Draft note',
            createdAt: '2026-09-19T13:02:00Z',
            state: 'PENDING',
          },
        ],
      },
    });
    const pr = toPr(ref, raw);
    expect(pr.threads.map((t) => t.id)).toEqual(['T1']);
    expect(pr.threads[0]?.comments.map((c) => c.id)).toEqual(['RC1']);
    expect(pr.comments.map((c) => c.id)).not.toContain('RC2');
    expect(pr.comments.map((c) => c.id)).not.toContain('RC3');
  });

  it('never lets a pending review mark the thread read as a touch', () => {
    const raw = rawPr();
    raw.reviews.nodes.push(pendingReview('Will check the cache keys'));
    const pr: Pr = toPr(ref, raw);
    const events = deriveEvents(pr, viewer, null);
    const check = touchedReadCheck({
      thread: {
        id: 'thread-42',
        reason: 'mention',
        unread: true,
        updatedAt: '2026-09-20T10:00:00.000Z',
        lastReadAt: '2026-09-19T11:30:00.000Z',
        subjectType: 'PullRequest',
        repo: 'acme/app',
        number: 42,
        title: pr.title,
      },
      pr,
      events,
      viewer,
      prFetchedAt: '2026-09-21T00:00:00.000Z',
      now: '2026-09-21T00:00:00.000Z',
    });
    expect(check).toEqual({ kind: 'skip', why: 'no_touch' });
  });
});

describe('toPr: truncation', () => {
  it('reads a PR without counts, or within the caps, as complete', () => {
    expect(toPr(ref, rawPr()).truncated).toBe(false);
    const raw = rawPr();
    raw.reviewThreads.totalCount = 1;
    const thread = raw.reviewThreads.nodes[0];
    if (thread) {
      thread.comments.totalCount = 1;
    }
    expect(toPr(ref, raw).truncated).toBe(false);
  });

  it('flags a PR with more review threads than the query took', () => {
    const raw = rawPr();
    raw.reviewThreads.totalCount = 51;
    expect(toPr(ref, raw).truncated).toBe(true);
  });

  it('flags a PR past any capped activity list: reviews, comments, commits, timeline', () => {
    const lists = ['reviews', 'comments', 'commits', 'timelineItems'] as const;
    for (const list of lists) {
      const raw = rawPr();
      raw[list].totalCount = raw[list].nodes.length + 1;
      expect(toPr(ref, raw).truncated, list).toBe(true);
    }
  });

  it('never quiet-reads a PR whose human comment sits before 60 bot comments', () => {
    const raw = rawPr();
    raw.reviewRequests.nodes = [];
    raw.reviewThreads.nodes = [];
    raw.reviews.nodes = [];
    raw.commits.nodes = [];
    raw.timelineItems.nodes = [];
    raw.headCommit.nodes = [];
    raw.comments.nodes = Array.from({ length: 60 }, (_, index) => ({
      id: `BOT${index}`,
      url: `https://github.com/acme/app/pull/42#issuecomment-${100 + index}`,
      author: { __typename: 'Bot', login: 'deploy-preview' },
      body: 'Preview updated',
      createdAt: new Date(Date.UTC(2026, 8, 20, 11, index)).toISOString(),
    }));
    // The human comment GitHub has but the query left out.
    raw.comments.totalCount = 61;
    const pr = toPr(ref, raw);
    const check = (snapshot: Pr) =>
      quietReadCheck({
        thread: {
          id: 'thread-42',
          reason: 'subscribed',
          unread: true,
          updatedAt: '2026-09-20T11:59:00.000Z',
          lastReadAt: '2026-09-20T10:30:00.000Z',
          subjectType: 'PullRequest',
          repo: 'acme/app',
          number: 42,
          title: snapshot.title,
        },
        pr: snapshot,
        events: deriveEvents(snapshot, viewer, null),
        userState: null,
        viewer,
        notYours: false,
        prFetchedAt: '2026-09-21T00:00:00.000Z',
        now: '2026-09-21T00:00:00.000Z',
      });

    expect(pr.truncated).toBe(true);
    expect(check(pr)).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    // The same comments as a complete list would pass as bots only.
    expect(check({ ...pr, truncated: false }).kind).toBe('mark');
  });

  it('flags a PR with more comments in one thread than the query took', () => {
    const raw = rawPr();
    raw.reviewThreads.totalCount = 1;
    const thread = raw.reviewThreads.nodes[0];
    if (!thread) {
      throw new Error('fixture thread is missing');
    }
    thread.comments.totalCount = 31;
    expect(toPr(ref, raw).truncated).toBe(true);
  });
});
