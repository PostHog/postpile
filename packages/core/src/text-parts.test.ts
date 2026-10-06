// The text rows round trip (DESIGN.md "PR storage"): the header columns,
// the text columns and the body row give back every field of the PR but
// its lists, missing ones missing: `capHits` missing never vouches while
// `[]` does, and a PR without `assignees` is refetched once.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { at, makePr } from './fixtures.ts';
import { joinText, splitText, type HeaderPart, type PrText } from './pr-parts.ts';
import { snapshotCoversSince } from './snapshot-coverage.ts';
import { boardSpecArb, buildBoard, CORPUS, CORPUS_SCENARIOS, corpusPrAfter, corpusPrBefore, PROPERTY_TIMEOUT_MS, propertyRuns } from './testing/index.ts';
import type { Pr } from './types.ts';

/** The header columns as the store writes them: a missing optional field as [] or false. */
function headerOf(pr: Pr): HeaderPart {
  return {
    key: pr.key,
    ref: pr.ref,
    title: pr.title,
    author: pr.author,
    assignees: pr.assignees ?? [],
    state: pr.state,
    isDraft: pr.isDraft,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    headOid: pr.headOid,
    reviewerUsers: pr.reviewerUsers,
    reviewerTeams: pr.reviewerTeams,
    previousBaseRefs: pr.previousBaseRefs ?? [],
    isCrossRepository: pr.isCrossRepository ?? false,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
  };
}

function textOf(pr: Pr): PrText {
  const { comments: _c, threads: _t, reviews: _r, commits: _m, timeline: _l, files: _f, mentionedTeams: _teams, ...text } = pr;
  return text;
}

function roundTrip(pr: Pr): PrText {
  return joinText(headerOf(pr), splitText(pr));
}

describe('splitText and joinText', () => {
  it('round-trip every PR of generated boards', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        for (const pr of buildBoard(spec).fullPrs.values()) {
          expect(roundTrip(pr)).toStrictEqual(textOf(pr));
        }
      }),
      { numRuns: Math.min(propertyRuns(), 300) },
    );
  }, PROPERTY_TIMEOUT_MS);

  it('round-trip every corpus PR, before and after each entry', () => {
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      for (const entry of Object.values(CORPUS)) {
        for (const pr of [corpusPrBefore(scenario.pr, entry), corpusPrAfter(scenario.pr, entry)]) {
          expect(roundTrip(pr)).toStrictEqual(textOf(pr));
        }
      }
    }
  });

  it('keeps capHits missing apart from an empty list, and truncated missing apart from false', () => {
    const missing = makePr({ truncated: true });
    const empty = makePr({ truncated: true, capHits: [] });
    expect(splitText(missing)).toMatchObject({ truncated: true, capHits: null });
    expect(splitText(empty)).toMatchObject({ capHits: [] });
    expect(roundTrip(missing)).not.toHaveProperty('capHits');
    expect(roundTrip(empty).capHits).toEqual([]);
    // What the difference is for: a cut snapshot without recorded cap hits never vouches; one with none hit does.
    expect(snapshotCoversSince(roundTrip(missing) as Pr, at(0))).toBe(false);
    expect(snapshotCoversSince(roundTrip(empty) as Pr, at(0))).toBe(true);

    const { truncated: _truncated, ...older } = makePr();
    expect(splitText(older).truncated).toBeNull();
    expect(roundTrip(older)).not.toHaveProperty('truncated');
    expect(roundTrip(makePr({ truncated: false })).truncated).toBe(false);
  });

  it('keeps cap hits whole, cursors and completion included', () => {
    const capHits = [
      { list: 'comments' as const, nodes: 100, oldestAt: at(3), cursor: 'Y3Vyc29y', complete: false },
      { list: 'thread_comments' as const, nodes: 50, oldestAt: null, threadId: 't1' },
    ];
    expect(roundTrip(makePr({ truncated: true, capHits })).capHits).toEqual(capHits);
  });

  it('keeps the label order and the merger', () => {
    const pr = makePr({ labels: ['zeta', 'Alpha', 'alpha'], state: 'MERGED', mergedAt: at(9), mergedBy: 'trunk-io[bot]' });
    expect(roundTrip(pr)).toMatchObject({ labels: ['zeta', 'Alpha', 'alpha'], mergedBy: 'trunk-io[bot]' });
  });

  it('gives back optional header fields a snapshot lacked as missing, not as empty', () => {
    const { assignees: _a, ...withoutAssignees } = makePr({ previousBaseRefs: ['old-base'], isCrossRepository: true });
    expect(splitText(withoutAssignees).absentFields).toEqual(['assignees']);
    const back = roundTrip(withoutAssignees);
    expect(back).not.toHaveProperty('assignees');
    expect(back).toMatchObject({ previousBaseRefs: ['old-base'], isCrossRepository: true });

    // makePr sets neither previousBaseRefs nor isCrossRepository, like a snapshot stored before they existed.
    const bare = makePr();
    expect(splitText(bare).absentFields).toEqual(['previousBaseRefs', 'isCrossRepository']);
    expect(roundTrip(bare)).toStrictEqual(textOf(bare));
  });
});
