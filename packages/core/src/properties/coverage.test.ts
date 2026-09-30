// The generator reaches every shape the rules branch on: each required label
// shows on at least 1% of boards, so thousands of property runs are never
// all trivial boards (testing/labels.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boardLabels, boardSpecArb, buildBoard, REQUIRED_LABELS, tileViewsOf } from '../testing/index.ts';

const BOARDS = 4000;
const MIN_SHARE = 0.01;

describe('generator coverage', () => {
  it('reaches every required label on at least 1% of boards', () => {
    const counts = new Map<string, number>();
    for (const spec of fc.sample(boardSpecArb, { numRuns: BOARDS, seed: 20260929 })) {
      const board = buildBoard(spec);
      for (const label of boardLabels(board, tileViewsOf(board))) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    const rare = REQUIRED_LABELS.filter((label) => (counts.get(label) ?? 0) < BOARDS * MIN_SHARE).map(
      (label) => `${label}: ${(((counts.get(label) ?? 0) / BOARDS) * 100).toFixed(1)}%`,
    );
    expect(rare).toEqual([]);
  });
});
