import { describe, expect, it } from 'vitest';
import { makePr, makeReview, viewer } from './fixtures.ts';
import { tilePeople } from './tile-people.ts';

describe('tilePeople', () => {
  it('lists the author, then the viewer when they reviewed, then other reviewers', () => {
    const pr = makePr({
      author: 'rowan',
      reviews: [makeReview({ author: 'mira', state: 'COMMENTED' }), makeReview({ author: viewer.login })],
      reviewerUsers: ['lyra'],
    });
    expect(tilePeople([pr], viewer.login)).toEqual([
      { login: 'rowan', role: 'author' },
      { login: viewer.login, role: 'you' },
      { login: 'mira', role: 'reviewer' },
      { login: 'lyra', role: 'reviewer' },
    ]);
  });

  it('lists each login once across PRs and caps the list', () => {
    const a = makePr({ number: 1, author: 'rowan', reviews: [makeReview({ author: 'lyra' })] });
    const b = makePr({ number: 2, author: 'rowan', reviewerUsers: ['lyra', 'nell', 'sol', 'jude'] });
    expect(tilePeople([a, b], viewer.login).map((p) => p.login)).toEqual(['rowan', 'lyra', 'nell', 'sol']);
  });

  it('leaves out the viewer while their review is only requested', () => {
    const pr = makePr({ author: 'rowan', reviewerUsers: [viewer.login, 'lyra'] });
    expect(tilePeople([pr], viewer.login).map((p) => p.login)).toEqual(['rowan', 'lyra']);
  });

  it('marks the viewer’s own PR as theirs and skips bot reviewers and pending reviews', () => {
    const pr = makePr({
      author: viewer.login,
      reviews: [makeReview({ author: 'greptile-apps[bot]' }), makeReview({ author: 'ada', state: 'PENDING' })],
    });
    expect(tilePeople([pr], viewer.login)).toEqual([{ login: viewer.login, role: 'you' }]);
  });

  it('keeps a bot author', () => {
    expect(tilePeople([makePr({ author: 'renovate[bot]' })], null)).toEqual([{ login: 'renovate[bot]', role: 'author' }]);
  });
});
