import { BOT_BODY_MAX, snapshotCoversSince, deriveEvents, quietReadCheck, touchedReadCheck, trimBotBody, type Pr } from '@postpile/core';
import { viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './fake-fetch.ts';
import { addOlderPage, toPr } from './normalize.ts';
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
      userState: null,
      viewer,
      prFetchedAt: '2026-09-21T00:00:00.000Z',
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
      });

    expect(pr.truncated).toBe(true);
    expect(pr.capHits).toEqual([{ list: 'comments', nodes: 60, oldestAt: '2026-09-20T11:00:00.000Z' }]);
    expect(check(pr)).toEqual({ kind: 'skip', why: 'stale_snapshot' });
    // The same comments as a complete list would pass as bots only.
    expect(check({ ...pr, truncated: false }).kind).toBe('mark');
  });

  it('records cap hits from the raw answer: 50 threads came back, 6 of them draft-only, and the snapshot stays untrusted', () => {
    const raw = rawPr();
    const template = raw.reviewThreads.nodes[0]!;
    raw.reviewThreads.nodes = Array.from({ length: 50 }, (_, index) => ({
      ...template,
      id: `RT${index}`,
      comments: { totalCount: 1, nodes: [{ ...template.comments.nodes[0]!, id: `RC${index}`, state: index < 6 ? 'PENDING' : 'SUBMITTED' }] },
    }));
    raw.reviewThreads.totalCount = 60;
    const pr = toPr(ref, raw);
    expect(pr.threads).toHaveLength(44);
    expect(pr.capHits).toEqual([{ list: 'review_threads', nodes: 50, oldestAt: null }]);
    expect(snapshotCoversSince(pr, '2026-09-30T00:00:00.000Z')).toBe(false);
  });

  it('records no cap hit for a list GitHub counts longer than it returns below the cap', () => {
    const raw = rawPr();
    raw.reviews.totalCount = raw.reviews.nodes.length + 2;
    const pr = toPr(ref, raw);
    expect(pr.truncated).toBe(true);
    expect(pr.capHits).toEqual([]);
    expect(snapshotCoversSince(pr, '2020-01-01T00:00:00.000Z')).toBe(true);
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

describe('toPr: assignees', () => {
  it('reads the assigned logins, skipping deleted users', () => {
    const raw = rawPr();
    raw.author = { __typename: 'Bot', login: 'lyra-agent' };
    raw.assignees = { nodes: [{ login: 'alice' }, null, { login: 'bob' }] };
    const pr = toPr(ref, raw);
    expect(pr.author).toBe('lyra-agent[bot]');
    expect(pr.assignees).toEqual(['alice', 'bob']);
  });

  it('reads no assignees from a fixture written before they were asked for', () => {
    const raw = rawPr();
    delete raw.assignees;
    expect(toPr(ref, raw).assignees).toEqual([]);
  });
});

describe('toPr: comment edits', () => {
  it('keeps when and by whom issue comments, review bodies and thread comments were last edited', () => {
    const raw = rawPr();
    Object.assign(raw.comments.nodes[0]!, {
      lastEditedAt: '2026-09-19T12:30:00Z',
      updatedAt: '2026-09-19T12:30:00Z',
      editor: { __typename: 'Bot', login: 'github-actions' },
    });
    Object.assign(raw.reviews.nodes[0]!, { lastEditedAt: '2026-09-19T10:05:00Z', editor: { __typename: 'User', login: 'bob' } });
    Object.assign(raw.reviewThreads.nodes[0]!.comments.nodes[0]!, { lastEditedAt: '2026-09-19T09:40:00Z', editor: null });
    const pr = toPr(ref, raw);
    const byId = (id: string) => pr.comments.find((comment) => comment.id === id);
    expect(byId('IC1')).toMatchObject({ lastEditedAt: '2026-09-19T12:30:00.000Z', editor: 'github-actions[bot]', updatedAt: '2026-09-19T12:30:00.000Z' });
    expect(byId('R1')).toMatchObject({ lastEditedAt: '2026-09-19T10:05:00.000Z', editor: 'bob' });
    expect(byId('RC1')).toMatchObject({ lastEditedAt: '2026-09-19T09:40:00.000Z', editor: null });
    expect(pr.threads[0]?.comments[0]?.lastEditedAt).toBe('2026-09-19T09:40:00.000Z');
  });

  it('reads a comment without edit fields (older fixtures) as never edited', () => {
    const pr = toPr(ref, rawPr());
    expect(pr.comments.every((comment) => comment.lastEditedAt === null && comment.editor === null)).toBe(true);
    expect(deriveEvents(pr, viewer, null).some((event) => event.kind === 'comment_edited')).toBe(false);
  });

  it('turns a bot sticky comment edit into one comment_edited event by the bot', () => {
    const raw = rawPr();
    raw.comments.nodes.push({
      id: 'IC3',
      url: 'https://github.com/acme/app/pull/42#issuecomment-3',
      author: { __typename: 'Bot', login: 'github-actions' },
      editor: { __typename: 'Bot', login: 'github-actions' },
      body: '## CI report\nAll green',
      createdAt: '2026-09-19T12:05:00Z',
      lastEditedAt: '2026-09-19T12:40:00Z',
    });
    const edits = deriveEvents(toPr(ref, raw), viewer, null).filter((event) => event.kind === 'comment_edited');
    expect(edits).toMatchObject([
      { id: 'acme/app#42:comment_edited:IC3@2026-09-19T12:40:00.000Z', actor: 'github-actions[bot]', isBot: true, ruleLoudness: 'quiet', summary: 'github-actions[bot] updated its comment: ## CI report' },
    ]);
  });
});

describe('toPr: viewer reactions', () => {
  it('marks comments, review bodies, thread comments and reviews the viewer gave a thumbs up', () => {
    const raw = rawPr();
    const thumbsUp = [
      { content: 'THUMBS_UP', viewerHasReacted: true },
      { content: 'HEART', viewerHasReacted: false },
    ];
    const heartOnly = [
      { content: 'HEART', viewerHasReacted: true },
      { content: 'THUMBS_UP', viewerHasReacted: false },
    ];
    Object.assign(raw.comments.nodes[0]!, { reactionGroups: thumbsUp });
    Object.assign(raw.comments.nodes[1]!, { reactionGroups: heartOnly });
    Object.assign(raw.reviews.nodes[0]!, { reactionGroups: thumbsUp });
    Object.assign(raw.reviews.nodes[1]!, { reactionGroups: thumbsUp });
    Object.assign(raw.reviewThreads.nodes[0]!.comments.nodes[0]!, { reactionGroups: thumbsUp });
    const pr = toPr(ref, raw);
    const byId = (id: string) => pr.comments.find((comment) => comment.id === id);
    expect(byId('IC1')?.viewerReacted).toBe(true);
    expect(byId('IC2')?.viewerReacted).toBe(false);
    expect(byId('R1')?.viewerReacted).toBe(true);
    expect(byId('RC1')?.viewerReacted).toBe(true);
    expect(pr.threads[0]?.comments[0]?.viewerReacted).toBe(true);
    // R2 has a blank body, so it is no comment, but the review still carries the reaction.
    expect(pr.reviews.find((review) => review.id === 'R2')?.viewerReacted).toBe(true);
  });

  it('leaves viewerReacted out when GitHub sent no reaction groups (older fixtures)', () => {
    const pr = toPr(ref, rawPr());
    expect(pr.comments.every((comment) => comment.viewerReacted === undefined)).toBe(true);
    expect(pr.reviews.every((review) => review.viewerReacted === undefined)).toBe(true);
  });
});

describe('toPr and addOlderPage: bot bodies', () => {
  const long = `Walkthrough\n${'- a long line of generated review notes\n'.repeat(200)}`;
  const bot = { __typename: 'Bot', login: 'coderabbitai' };
  const person = { __typename: 'User', login: 'alice' };
  const short = trimBotBody({ author: 'coderabbitai[bot]', body: long });

  it('cuts a bot body in every copy it lands in, and leaves people and the description alone', () => {
    const raw = rawPr();
    raw.body = long;
    Object.assign(raw.comments.nodes[0]!, { author: bot, body: long });
    Object.assign(raw.comments.nodes[1]!, { author: person, body: long });
    Object.assign(raw.reviews.nodes[0]!, { author: bot, body: long });
    Object.assign(raw.reviewThreads.nodes[0]!.comments.nodes[0]!, { author: bot, body: long });
    const pr = toPr(ref, raw);
    expect(short.length).toBeLessThanOrEqual(BOT_BODY_MAX);
    const byId = (id: string) => pr.comments.find((comment) => comment.id === id)?.body;
    expect([byId('IC1'), byId('IC2'), byId('R1'), byId('RC1')]).toEqual([short, long, short, short]);
    expect(pr.reviews.find((review) => review.id === 'R1')?.body).toBe(short);
    expect(pr.threads[0]?.comments[0]?.body).toBe(short);
    expect(pr.body).toBe(long);
  });

  it('keeps a bot body a person edited last whole, in the review and its comment copy', () => {
    const raw = rawPr();
    Object.assign(raw.comments.nodes[0]!, { author: bot, body: long, editor: person, lastEditedAt: '2026-09-19T12:30:00Z' });
    Object.assign(raw.reviews.nodes[0]!, { author: bot, body: long, editor: person, lastEditedAt: '2026-09-19T12:30:00Z' });
    const pr = toPr(ref, raw);
    expect(pr.comments.find((comment) => comment.id === 'IC1')?.body).toBe(long);
    expect(pr.comments.find((comment) => comment.id === 'R1')?.body).toBe(long);
    expect(pr.reviews.find((review) => review.id === 'R1')?.body).toBe(long);
  });

  it('cuts the bot bodies an older page brings in', () => {
    const pr = toPr(ref, rawPr());
    const older = addOlderPage(pr, {
      list: 'comments',
      page: {
        nodes: [{ id: 'IC0', url: 'https://github.com/acme/app/pull/42#issuecomment-0', author: bot, body: long, createdAt: '2026-09-18T09:00:00Z' }],
        pageInfo: { hasPreviousPage: false, startCursor: null },
      },
    });
    expect(older.comments.find((comment) => comment.id === 'IC0')?.body).toBe(short);
  });
});
