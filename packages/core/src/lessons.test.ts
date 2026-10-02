import { describe, expect, it } from 'vitest';
import { at, makeComment, makeEvent, makePr, makeReview, viewer } from './fixtures.ts';
import { lessonMismatch, normalizeLessonText, onlyAddsLesson, possibleMisses, repeatsDismissed, reviewNow } from './lessons.ts';
import type { Glance, Pr, PrEvent } from './types.ts';

function glance(overrides: Partial<Glance> = {}): Glance {
  return {
    prKey: 'acme/app#1',
    verdict: 'LOOKS_SAFE',
    forYou: 'Nothing for you.',
    does: 'Renames a helper.',
    risk: 'low - rename only',
    othersSaid: 'nobody yet',
    keyFiles: [],
    pullInReason: null,
    dossierVersion: 1,
    inputHash: 'h',
    model: 'm',
    createdAt: at(5),
    headOid: 'head',
    ...overrides,
  };
}

const changes = makeReview({ id: 'r9', author: viewer.login, state: 'CHANGES_REQUESTED', body: 'This drops the backfill.', submittedAt: at(30), commitOid: 'head' });

function prWith(overrides: Partial<Pr> = {}): Pr {
  return makePr({ reviews: [changes], ...overrides });
}

function changesRequested(overrides: Partial<PrEvent> = {}): PrEvent {
  return makeEvent({ id: 'acme/app#1:review_changes_requested:r9', kind: 'review_changes_requested', actor: viewer.login, at: at(30), sourceId: 'r9', ...overrides });
}

describe('lessonMismatch', () => {
  it('reads safety, relevance and an underrated risk; a real Look closer is no mismatch', () => {
    expect(lessonMismatch(glance())).toBe('safety');
    expect(lessonMismatch(glance({ verdict: 'NOT_YOURS', risk: 'high - auth' }))).toBe('relevance');
    expect(lessonMismatch(glance({ verdict: 'LOOK_CLOSER', risk: 'Low: docs' }))).toBe('risk');
    expect(lessonMismatch(glance({ verdict: 'LOOK_CLOSER', risk: 'medium - touches the loop' }))).toBeNull();
  });
});

describe('possibleMisses', () => {
  it('keeps what the glance said and the review', () => {
    expect(possibleMisses(prWith(), [changesRequested()], glance(), viewer)).toEqual([
      {
        prKey: 'acme/app#1',
        mismatch: 'safety',
        glance: { verdict: 'LOOKS_SAFE', risk: 'low - rename only', forYou: 'Nothing for you.', does: 'Renames a helper.', createdAt: at(5), headOid: 'head' },
        review: { id: 'r9', submittedAt: at(30), commitOid: 'head', body: 'This drops the backfill.', comments: [] },
      },
    ]);
  });

  it('takes the inline comments that went with the review, not those of an earlier one', () => {
    const earlier = makeReview({ id: 'r1', author: viewer.login, state: 'COMMENTED', submittedAt: at(10) });
    const comments = [
      makeComment({ id: 'c-old', author: viewer.login, kind: 'review_comment', path: 'a.ts', body: 'old point', createdAt: at(9) }),
      makeComment({ id: 'c-new', author: viewer.login, kind: 'review_comment', path: 'core/x.ts', body: 'imports from ee/', createdAt: at(25) }),
      makeComment({ id: 'c-bob', author: 'bob', kind: 'review_comment', path: 'core/x.ts', body: 'fair', createdAt: at(26) }),
    ];
    const pr = prWith({ reviews: [earlier, { ...changes, body: '' }], comments });

    const [miss] = possibleMisses(pr, [changesRequested()], glance(), viewer);

    expect(miss?.review).toMatchObject({ body: '', comments: [{ path: 'core/x.ts', body: 'imports from ee/' }] });
  });

  it('leaves out a review on code the glance never saw, and a glance written after the review', () => {
    expect(possibleMisses(prWith(), [changesRequested()], glance({ headOid: 'older' }), viewer)).toEqual([]);
    expect(possibleMisses(prWith(), [changesRequested()], glance({ createdAt: at(40) }), viewer)).toEqual([]);
    // A glance stored before the head was recorded still counts.
    expect(possibleMisses(prWith(), [changesRequested()], glance({ headOid: undefined }), viewer)).toHaveLength(1);
  });

  it('needs a glance that let it through, the viewer as reviewer and a change request', () => {
    expect(possibleMisses(prWith(), [changesRequested()], null, viewer)).toEqual([]);
    expect(possibleMisses(prWith(), [changesRequested()], glance({ verdict: 'LOOK_CLOSER', risk: 'high - drops a column' }), viewer)).toEqual([]);
    expect(possibleMisses(prWith(), [changesRequested({ actor: 'bob' })], glance(), viewer)).toEqual([]);
    expect(possibleMisses(prWith(), [changesRequested({ kind: 'review_approved' })], glance(), viewer)).toEqual([]);
  });
});

describe('reviewNow', () => {
  const [miss] = possibleMisses(prWith(), [changesRequested()], glance(), viewer);
  const stored = miss!.review;

  it('sees an unchanged, an edited and a deleted review', () => {
    expect(reviewNow(stored, prWith(), viewer)).toEqual({ kind: 'same' });
    const edited = reviewNow(stored, prWith({ reviews: [{ ...changes, body: 'Drops the backfill and the index.' }] }), viewer);
    expect(edited).toMatchObject({ kind: 'edited', review: { body: 'Drops the backfill and the index.' } });
    expect(reviewNow(stored, prWith({ reviews: [] }), viewer)).toEqual({ kind: 'deleted' });
    expect(reviewNow(stored, prWith({ reviews: [{ ...changes, state: 'DISMISSED' }] }), viewer)).toEqual({ kind: 'deleted' });
  });

  it('trusts a capped snapshot only for what it surely holds', () => {
    const cutOff = { truncated: true, capHits: [{ list: 'reviews', nodes: 50, oldestAt: at(40) }] } satisfies Partial<Pr>;
    // The review fell past the reviews cap: not deleted.
    expect(reviewNow(stored, prWith({ ...cutOff, reviews: [] }), viewer)).toEqual({ kind: 'same' });
    // The newest 50 reach back before the review: then it really is gone.
    expect(reviewNow(stored, prWith({ ...cutOff, capHits: [{ list: 'reviews', nodes: 50, oldestAt: at(20) }], reviews: [] }), viewer)).toEqual({ kind: 'deleted' });
    // Inline comments may be cut off: their absence is no edit, a changed body still is.
    const withComment = { ...stored, comments: [{ path: 'x.ts', body: 'first' }] };
    expect(reviewNow(withComment, prWith(cutOff), viewer)).toEqual({ kind: 'same' });
    expect(reviewNow(withComment, prWith({ ...cutOff, reviews: [{ ...changes, body: 'new body' }] }), viewer)).toMatchObject({ kind: 'edited', review: { body: 'new body', comments: [{ body: 'first' }] } });
  });

  it('counts an edited inline comment as an edit', () => {
    const comment = makeComment({ id: 'c1', author: viewer.login, kind: 'review_comment', path: 'x.ts', body: 'first', createdAt: at(20) });
    const pr = prWith({ comments: [comment] });
    const [withComment] = possibleMisses(pr, [changesRequested()], glance(), viewer);
    const now = reviewNow(withComment!.review, prWith({ comments: [{ ...comment, body: 'second' }] }), viewer);
    expect(now.kind).toBe('edited');
  });
});

describe('dismissed lines', () => {
  it('match on words, not punctuation or case', () => {
    expect(normalizeLessonText('When core imports from ee/, look closer.')).toBe('when core imports from ee look closer');
    expect(repeatsDismissed('when core imports from EE, look closer', ['When core imports from ee/ — look closer.'])).toBe(true);
    expect(repeatsDismissed('Flag migrations without a backfill', ['When core imports from ee/, look closer.'])).toBe(false);
  });
});

describe('onlyAddsLesson', () => {
  const before = '# Reviews\n- I own CI config\n- Ping me on migrations\n';

  it('accepts a few added lines that keep every old line in order', () => {
    expect(onlyAddsLesson(before, '# Reviews\n- I own CI config\n- Ping me on migrations\n- Look closer when core imports from ee/\n')).toBe(true);
    expect(onlyAddsLesson('', '- Look closer when core imports from ee/\n')).toBe(true);
  });

  it('rejects a changed or dropped line, no addition at all, and a long addition', () => {
    expect(onlyAddsLesson(before, '# Reviews\n- I own CI and release config\n- Ping me on migrations\n- New line\n')).toBe(false);
    expect(onlyAddsLesson(before, '# Reviews\n- Ping me on migrations\n- New line\n')).toBe(false);
    expect(onlyAddsLesson(before, before)).toBe(false);
    expect(onlyAddsLesson(before, `${before}- a\n- b\n- c\n- d\n- e\n`)).toBe(false);
  });
});
