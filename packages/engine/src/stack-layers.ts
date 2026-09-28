import { oneLayerPerHead, prKey, sitsOn, type IsoTime, type LayerShape, type Pr, type PrKey, type PrRef, type PullIn } from '@postpile/core';
import type { BranchLookup, BranchPr, GitHubReader } from '@postpile/github';

/** Layers walked each way from a seed PR. Deeper stacks are rare and would cost a query per layer. */
export const STACK_DEPTH = 6;

type Direction = 'below' | 'above';

/** Where one walk stands: the PR it reached, which way it goes, and the seed PR it started from. */
interface Step {
  from: LayerShape;
  direction: Direction;
  anchor: PrRef;
}

/** A PR that completes a stack, found by branch. */
export interface StackLayer {
  ref: PrRef;
  /** From the branch lookup; the full snapshot is fetched only when this moved. */
  updatedAt: IsoTime;
  pullIn: PullIn;
}

/**
 * The layer below has this PR's base branch as its head, or one of its
 * former base branches (GitHub moves a PR down when the layer below merges).
 * The layers above have this PR's head as their base.
 */
function lookupsFor(step: Step): BranchLookup[] {
  const repo = step.from.ref.repo;
  if (step.direction === 'below') {
    const branches = [step.from.baseRef, ...(step.from.previousBaseRefs ?? [])];
    return branches.map((branch) => ({ repo, branch, side: 'head' as const }));
  }
  return [{ repo, branch: step.from.headRef, side: 'base' }];
}

function lookupKey(lookup: BranchLookup): string {
  return `${lookup.repo}\n${lookup.side}\n${lookup.branch}`;
}

/**
 * What one step reaches, with the same rules as `buildStacks`: the one PR
 * below (the current base before a former one), or every PR above, one per
 * head branch. Any state counts: open, draft, merged at any age, closed.
 */
function layersFor(step: Step, answers: BranchPr[]): BranchPr[] {
  if (step.direction === 'above') {
    return oneLayerPerHead(answers.filter((match) => sitsOn(match, step.from)));
  }
  const candidates = oneLayerPerHead(answers.filter((match) => sitsOn(step.from, match)));
  const direct = candidates.find((match) => match.headRef === step.from.baseRef);
  return direct ? [direct] : candidates.slice(0, 1);
}

function firstSteps(seed: Pr): Step[] {
  const directions: Direction[] = ['below', 'above'];
  return directions.map((direction) => ({ from: seed, direction, anchor: seed.ref }));
}

/**
 * Finds the stack neighbours of seed PRs by branch, without the agent: one
 * batched branch lookup per layer, at most STACK_DEPTH layers each way.
 * Every layer counts whatever its state, so a stack always shows whole. A
 * walk stops at another seed (it walks its own stack) and goes on through a
 * tracked PR that is no seed, which is never recorded as pulled in.
 */
export class StackLayerFinder {
  constructor(
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
  ) {}

  /** Answers per step, all its lookups together. Two walks on the same branch share one lookup. */
  private async lookUp(steps: Step[]): Promise<BranchPr[][]> {
    const unique = new Map<string, BranchLookup>();
    for (const step of steps) {
      for (const lookup of lookupsFor(step)) {
        unique.set(lookupKey(lookup), lookup);
      }
    }
    const lookups = [...unique.values()];
    const answers = await this.reader.findPrsByBranch(lookups);
    const byKey = new Map(lookups.map((lookup, index) => [lookupKey(lookup), answers[index] ?? []]));
    return steps.map((step) => lookupsFor(step).flatMap((lookup) => byKey.get(lookupKey(lookup)) ?? []));
  }

  /** seeds: tracked PRs whose stacks to walk. tracked: every PR with a notification thread or found by the sync. */
  async find(seeds: Pr[], tracked: Set<PrKey>): Promise<StackLayer[]> {
    const at = this.now().toISOString();
    const visited = new Set<PrKey>(seeds.map((pr) => pr.key));
    const found: StackLayer[] = [];
    let steps = seeds.flatMap(firstSteps);
    for (let depth = 1; depth <= STACK_DEPTH && steps.length > 0; depth++) {
      const answers = await this.lookUp(steps);
      const next: Step[] = [];
      steps.forEach((step, index) => {
        for (const match of layersFor(step, answers[index] ?? [])) {
          const key = prKey(match.ref);
          if (visited.has(key)) {
            continue;
          }
          visited.add(key);
          next.push({ from: match, direction: step.direction, anchor: step.anchor });
          if (tracked.has(key)) {
            continue;
          }
          const reason = `stack layer ${step.direction} #${step.anchor.number}`;
          found.push({ ref: match.ref, updatedAt: match.updatedAt, pullIn: { prKey: key, anchorPrKey: prKey(step.anchor), reason, pulledAt: at } });
        }
      });
      steps = next;
    }
    return found;
  }
}
