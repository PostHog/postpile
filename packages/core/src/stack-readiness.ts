// When a stack can land: every open layer it lands with is ready to merge.
// The lowest layer that is not names what holds it, so "Merge, it is
// approved" never claims a stack is ready while a layer it ships with still
// waits on a review. Works on any stack a tile holds (`Tile.stacks`), however
// it was found. Rules only. DESIGN.md "Stacks land together" has the rule.
import { mergeQueueState } from './merge-queue.ts';
import { prOwner } from './pr-owners.ts';
import { isQueued } from './pr-status.ts';
import { standingChanges } from './changes-answered.ts';
import type { Pr, PrKey, TileStack } from './types.ts';

/**
 * What holds one open layer back from merging, and who has to move:
 * draft: the author marks it ready. queue_failed: the merge queue took it
 * out, the author re-submits. changes: the author addresses `by`'s change
 * request. re_review: `who` asked for changes and was asked again.
 * review: `who` (and `more` others) are asked for a review and GitHub has
 * no approval yet. approval: GitHub wants an approving review and nobody is
 * asked.
 */
export type LayerHold =
  | { kind: 'draft'; who: string }
  | { kind: 'queue_failed'; who: string }
  | { kind: 'changes'; who: string; by: string }
  | { kind: 're_review'; who: string }
  | { kind: 'review'; who: string; more: number }
  | { kind: 'approval' };

/** The layer that holds a stack back and why. */
export interface StackBlocker {
  pr: Pr;
  hold: LayerHold;
}

/**
 * What keeps one layer from merging, null when nothing does. Merged and
 * closed layers hold nothing (a closed one no longer lands with the
 * stack), and neither does a layer already in a merge queue: it is landing.
 * Pending reviewers hold a layer only until GitHub says approved, the same
 * order as "Waiting on" on your own PR.
 */
export function layerHold(pr: Pr): LayerHold | null {
  if (pr.state !== 'OPEN') {
    return null;
  }
  if (pr.isDraft) {
    return { kind: 'draft', who: prOwner(pr) };
  }
  const queue = mergeQueueState(pr);
  if (queue?.state === 'failed') {
    return { kind: 'queue_failed', who: prOwner(pr) };
  }
  if (queue !== null || isQueued(pr)) {
    return null;
  }
  const changes = standingChanges(pr);
  if (changes?.kind === 're_review') {
    return { kind: 're_review', who: changes.by };
  }
  if (changes) {
    return { kind: 'changes', who: prOwner(pr), by: changes.by };
  }
  if (pr.reviewDecision === 'APPROVED') {
    return null;
  }
  const reviewers = [...pr.reviewerUsers, ...pr.reviewerTeams];
  if (reviewers.length > 0) {
    return { kind: 'review', who: reviewers[0]!, more: reviewers.length - 1 };
  }
  if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === 'CHANGES_REQUESTED') {
    return { kind: 'approval' };
  }
  return null;
}

/** The lowest of these layers (bottom first) that something holds back, null when all of them can merge. */
export function firstBlocker(layers: Pr[]): StackBlocker | null {
  for (const pr of layers) {
    const hold = layerHold(pr);
    if (hold) {
      return { pr, hold };
    }
  }
  return null;
}

/** An open layer GitHub would merge now on its own: approved, not a draft, nothing held, and not already in a merge queue. */
function canLandAlone(pr: Pr): boolean {
  return pr.state === 'OPEN' && pr.reviewDecision === 'APPROVED' && layerHold(pr) === null && mergeQueueState(pr) === null && !isQueued(pr);
}

/**
 * The layers below a stack's lowest held layer that can land on their own
 * (bottom first), while the stack as a whole waits. Empty when no layer is
 * held or the bottom layer is: then nothing lands alone. Layers below the
 * lowest held one are never held themselves, so the list only leaves out
 * merged, closed, queued and unapproved ones.
 */
export function landableBelow(layers: Pr[]): Pr[] {
  const held = layers.findIndex((pr) => layerHold(pr) !== null);
  if (held <= 0) {
    return [];
  }
  return layers.slice(0, held).filter(canLandAlone);
}

/**
 * The other layers of the stack a PR is in, as the tile holds them:
 * `below` (bottom first) land before it or with it, `above` (bottom first)
 * are the layers it ships with. Both empty when the PR is in no stack;
 * layers without a stored PR are left out.
 */
export function stackLayersAround(stacks: TileStack[], key: PrKey, prs: ReadonlyMap<PrKey, Pr>): { below: Pr[]; above: Pr[] } {
  const stack = stacks.find((candidate) => candidate.prKeys.includes(key));
  if (!stack) {
    return { below: [], above: [] };
  }
  const index = stack.prKeys.indexOf(key);
  const layersOf = (keys: PrKey[]) => keys.flatMap((layer) => prs.get(layer) ?? []);
  return { below: layersOf(stack.prKeys.slice(0, index)), above: layersOf(stack.prKeys.slice(index + 1)) };
}
