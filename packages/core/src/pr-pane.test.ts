import { describe, expect, it } from 'vitest';
import { at, makeComment, makeCommit, makePr, makeReview, makeThread, makeTimelineItem } from './fixtures.ts';
import { prPaneView } from './pr-pane.ts';

const PANE_FIELDS = [
  'additions',
  'assignees',
  'author',
  'baseRef',
  'body',
  'changedFiles',
  'createdAt',
  'deletions',
  'files',
  'headOid',
  'headRef',
  'isDraft',
  'key',
  'lastCommitAt',
  'mergedAt',
  'mergedBy',
  'ref',
  'reviewDecision',
  'reviewerTeams',
  'reviewerUsers',
  'reviews',
  'state',
  'title',
  'updatedAt',
  'url',
];

describe('prPaneView', () => {
  it('ships the fields the pane reads and nothing else', () => {
    const pr = makePr({
      truncated: true,
      capHits: [{ list: 'comments', nodes: 100, oldestAt: at(1) }],
      previousBaseRefs: ['old-base'],
      isCrossRepository: false,
      labels: ['ci'],
    });
    expect(Object.keys(prPaneView(pr)).sort()).toEqual(PANE_FIELDS);
  });

  it('keeps the header, the whole description and the files', () => {
    const body = 'x'.repeat(20_000);
    const pr = makePr({
      number: 7,
      title: 'Cache keys',
      body,
      author: 'rowan',
      assignees: ['lyra'],
      isDraft: true,
      baseRef: 'main',
      headRef: 'rowan/cache',
      headOid: 'abc123',
      files: [{ path: 'turbo.json', additions: 12, deletions: 4 }],
      reviewerUsers: ['viewer'],
      reviewerTeams: ['acme/team-platform'],
      mergedBy: null,
    });
    expect(prPaneView(pr)).toMatchObject({
      key: 'acme/app#7',
      ref: { repo: 'acme/app', number: 7 },
      title: 'Cache keys',
      url: 'https://github.com/acme/app/pull/7',
      body,
      author: 'rowan',
      assignees: ['lyra'],
      isDraft: true,
      baseRef: 'main',
      headRef: 'rowan/cache',
      headOid: 'abc123',
      files: [{ path: 'turbo.json', additions: 12, deletions: 4 }],
      reviewerUsers: ['viewer'],
      reviewerTeams: ['acme/team-platform'],
    });
  });

  it('reads missing assignees as none', () => {
    const { assignees: _dropped, ...older } = makePr();
    expect(prPaneView(older).assignees).toEqual([]);
  });

  it('keeps who reviewed, how and when, without the review text', () => {
    const pr = makePr({
      reviews: [makeReview({ id: 'r1', author: 'lyra', state: 'APPROVED', body: 'Ship it.', submittedAt: at(20), viewerReacted: true })],
    });
    expect(prPaneView(pr).reviews).toEqual([{ author: 'lyra', state: 'APPROVED', submittedAt: at(20) }]);
  });

  it('takes the last commit time, null without commits', () => {
    const pr = makePr({ commits: [makeCommit({ oid: 'a', committedAt: at(5) }), makeCommit({ oid: 'b', committedAt: at(9) })] });
    expect(prPaneView(pr).lastCommitAt).toBe(at(9));
    expect(prPaneView(makePr()).lastCommitAt).toBeNull();
  });

  it('stays small however much the PR has talked', () => {
    const report = 'CI report '.repeat(300);
    const comments = Array.from({ length: 200 }, (_, index) => makeComment({ id: `c${index}`, author: 'ci-bot[bot]', body: report }));
    const thread = makeThread('t1', [makeComment({ id: 't1-0', body: report })]);
    const timeline = Array.from({ length: 100 }, (_, index) => makeTimelineItem({ id: `tl${index}` }));
    const pr = makePr({ comments, threads: [thread], timeline });
    expect(JSON.stringify(pr).length).toBeGreaterThan(600_000);
    expect(JSON.stringify(prPaneView(pr)).length).toBeLessThan(1_000);
  });
});
