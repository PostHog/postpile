// The activity rows round trip (DESIGN.md "PR storage"): what the store
// writes for a PR's commits, timeline and files gives back the same lists,
// in stored order, a missing committer included, and a list with an id or
// path twice is refused.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { changesAnswered } from './changes-answered.ts';
import { at, makeCommit, makePr, makeTimelineItem } from './fixtures.ts';
import { lastTouch } from './last-touch.ts';
import { prAsOf } from './pr-as-of.ts';
import { ActivityError, joinActivity, splitActivity, type Activity, type ActivityParts } from './pr-parts.ts';
import { boardSpecArb, buildBoard, CORPUS, CORPUS_SCENARIOS, corpusPrAfter, corpusPrBefore, PROPERTY_TIMEOUT_MS, propertyRuns } from './testing/index.ts';
import type { Pr } from './types.ts';

function activityOf(pr: Activity): Activity {
  return { commits: pr.commits, timeline: pr.timeline, files: pr.files };
}

function roundTrip(pr: Activity): Activity {
  return joinActivity(splitActivity(pr));
}

/** The PR with its activity lists as the rows give them back. */
function fromRows<T extends Pr>(pr: T): T {
  return { ...pr, ...roundTrip(pr) };
}

describe('splitActivity and joinActivity', () => {
  it('round-trip every PR of generated boards, and every rule reads the same', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        for (const pr of board.prs.values()) {
          const back = fromRows(pr);
          expect(activityOf(back)).toEqual(activityOf(pr));
          const events = board.events.get(pr.key) ?? [];
          expect(changesAnswered(back, board.viewer)).toEqual(changesAnswered(pr, board.viewer));
          expect(lastTouch(back, events, board.viewer)).toEqual(lastTouch(pr, events, board.viewer));
          expect(prAsOf(back, board.now)).toEqual(prAsOf(pr, board.now));
        }
      }),
      { numRuns: Math.min(propertyRuns(), 300) },
    );
  }, PROPERTY_TIMEOUT_MS);

  it('round-trip every corpus PR, before and after each entry', () => {
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      for (const entry of Object.values(CORPUS)) {
        for (const pr of [corpusPrBefore(scenario.pr, entry), corpusPrAfter(scenario.pr, entry)]) {
          expect(roundTrip(pr)).toEqual(activityOf(pr));
        }
      }
    }
  });

  it('keeps the stored commit order, older pages paged in first and not in time order', () => {
    // An older page of commits goes in front of the newest page (cap-fill), whatever their times say.
    const commits = [
      makeCommit({ oid: 'old-2', committedAt: at(5) }),
      makeCommit({ oid: 'old-1', committedAt: at(3) }),
      makeCommit({ oid: 'new-1', committedAt: at(20) }),
      makeCommit({ oid: 'new-2', committedAt: at(20) }),
    ];
    expect(roundTrip(makePr({ commits })).commits.map((commit) => commit.oid)).toEqual(['old-2', 'old-1', 'new-1', 'new-2']);
  });

  it('reads a missing committer back as missing, a known one as it was', () => {
    // Snapshots stored before the committer was fetched have none.
    const { committer: _committer, ...withoutCommitter } = makeCommit({ oid: 'a' });
    const pr = makePr({ commits: [withoutCommitter, makeCommit({ oid: 'b', committer: 'web-flow' })] });
    expect(splitActivity(pr).commits.map((commit) => commit.committer)).toEqual([null, 'web-flow']);
    const back = roundTrip(pr).commits;
    expect(back[0]).not.toHaveProperty('committer');
    expect(back[1]!.committer).toBe('web-flow');
  });

  it('keeps a timeline item without a subject and the files in GitHub order', () => {
    const pr = makePr({
      timeline: [makeTimelineItem({ id: 'i1', kind: 'review_requested', subject: null }), makeTimelineItem({ id: 'i2', kind: 'review_requested', subject: 'acme/team-platform' })],
      files: [
        { path: 'z.ts', additions: 1, deletions: 0 },
        { path: 'A.ts', additions: 0, deletions: 3 },
        { path: 'a.ts', additions: 2, deletions: 2 },
      ],
    });
    expect(roundTrip(pr)).toEqual(activityOf(pr));
  });

  it('refuses a commit, timeline item or file path twice instead of keeping one', () => {
    expect(() => splitActivity(makePr({ commits: [makeCommit({ oid: 'a' }), makeCommit({ oid: 'a', headline: 'other' })] }))).toThrow(ActivityError);
    expect(() => splitActivity(makePr({ timeline: [makeTimelineItem({ id: 'i1' }), makeTimelineItem({ id: 'i1' })] }))).toThrow(ActivityError);
    expect(() =>
      splitActivity(
        makePr({
          files: [
            { path: 'a.ts', additions: 1, deletions: 0 },
            { path: 'a.ts', additions: 2, deletions: 0 },
          ],
        }),
      ),
    ).toThrow(/file a.ts is stored twice/);
  });

  it('refuses rows with a position used twice', () => {
    const parts: ActivityParts = {
      commits: [],
      timeline: [],
      files: [
        { path: 'a.ts', ord: 0, additions: 1, deletions: 0 },
        { path: 'b.ts', ord: 0, additions: 1, deletions: 0 },
      ],
    };
    expect(() => joinActivity(parts)).toThrow(ActivityError);
  });
});
