import { MERGED_LAYER_DAYS, prKey, type IsoTime, type Pr, type PrKey, type PrRef, type PullIn } from '@code-manager/core';
import type { BranchLookup, BranchPr, GitHubReader } from '@code-manager/github';

/** Layers walked each way from a pinged PR. Deeper stacks are rare and would cost a query per layer. */
export const STACK_DEPTH = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

type Direction = 'below' | 'above';

/** Where one walk stands: the PR it reached, which way it goes, and the pinged PR it started from. */
interface Step {
  repo: string;
  baseRef: string;
  headRef: string;
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

/** The layer below sits on this PR's base branch as its head; the layer above has this PR's head as its base. */
function lookupFor(step: Step): BranchLookup {
  if (step.direction === 'below') {
    return { repo: step.repo, branch: step.baseRef, side: 'head' };
  }
  return { repo: step.repo, branch: step.headRef, side: 'base' };
}

function lookupKey(lookup: BranchLookup): string {
  return `${lookup.repo}\n${lookup.side}\n${lookup.branch}`;
}

function firstSteps(seed: Pr): Step[] {
  const directions: Direction[] = ['below', 'above'];
  return directions.map((direction) => ({
    repo: seed.ref.repo,
    baseRef: seed.baseRef,
    headRef: seed.headRef,
    direction,
    anchor: seed.ref,
  }));
}

/**
 * Finds the stack neighbours of pinged PRs by branch, without the agent:
 * one batched branch lookup per layer, at most STACK_DEPTH layers each way.
 * Only open layers and ones merged in the last MERGED_LAYER_DAYS count. A
 * walk stops at a PR the user has a thread for: that one is pinged and
 * walks its own stack when it is fetched.
 */
export class StackLayerFinder {
  constructor(
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
  ) {}

  private isLive(pr: BranchPr): boolean {
    if (pr.state === 'OPEN') {
      return true;
    }
    if (pr.state !== 'MERGED' || pr.mergedAt === null) {
      return false;
    }
    const cutoff = new Date(this.now().getTime() - MERGED_LAYER_DAYS * DAY_MS).toISOString();
    return pr.mergedAt >= cutoff;
  }

  /** Answers per step. Two walks on the same branch share one lookup. */
  private async lookUp(steps: Step[]): Promise<BranchPr[][]> {
    const unique = new Map<string, BranchLookup>();
    for (const step of steps) {
      const lookup = lookupFor(step);
      unique.set(lookupKey(lookup), lookup);
    }
    const lookups = [...unique.values()];
    const answers = await this.reader.findPrsByBranch(lookups);
    const byKey = new Map(lookups.map((lookup, index) => [lookupKey(lookup), answers[index] ?? []]));
    return steps.map((step) => byKey.get(lookupKey(lookupFor(step))) ?? []);
  }

  /** seeds: pinged PRs fetched this sync. pinged: every PR with a notification thread. */
  async find(seeds: Pr[], pinged: Set<PrKey>): Promise<StackLayer[]> {
    const at = this.now().toISOString();
    const visited = new Set<PrKey>(seeds.map((pr) => pr.key));
    const found: StackLayer[] = [];
    let steps = seeds.flatMap(firstSteps);
    for (let depth = 1; depth <= STACK_DEPTH && steps.length > 0; depth++) {
      const answers = await this.lookUp(steps);
      const next: Step[] = [];
      steps.forEach((step, index) => {
        for (const match of answers[index] ?? []) {
          const key = prKey(match.ref);
          if (visited.has(key) || !this.isLive(match)) {
            continue;
          }
          visited.add(key);
          if (pinged.has(key)) {
            continue;
          }
          const reason = `stack layer ${step.direction} #${step.anchor.number}`;
          found.push({ ref: match.ref, updatedAt: match.updatedAt, pullIn: { prKey: key, anchorPrKey: prKey(step.anchor), reason, pulledAt: at } });
          next.push({ repo: match.ref.repo, baseRef: match.baseRef, headRef: match.headRef, direction: step.direction, anchor: step.anchor });
        }
      });
      steps = next;
    }
    return found;
  }
}
