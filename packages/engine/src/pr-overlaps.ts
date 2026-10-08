import { buildStacks, findOverlaps, stackByPrKey, type PrKey, type PrOverlapsView, type Stack } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * Open PRs that edit the same lines as another open PR (DESIGN.md
 * "Overlapping edits"), from the stored diffs. Stacks are worked out only
 * when two PRs overlap at all, since most boards have none.
 */
export function readPrOverlaps(store: Store): PrOverlapsView {
  const edits = store.prDiffs.listOpenEdits();
  let stackOf: Map<PrKey, Stack> | null = null;
  const sameStack = (a: PrKey, b: PrKey) => {
    stackOf ??= stackByPrKey(buildStacks(store.prs.listHeaders()));
    const stack = stackOf.get(a);
    return stack !== undefined && stack === stackOf.get(b);
  };
  const found = findOverlaps(edits, sameStack);
  return {
    overlaps: Object.fromEntries(found),
    capped: edits.filter((entry) => entry.capped).map((entry) => entry.prKey),
  };
}
