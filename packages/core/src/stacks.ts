import type { IsoTime, Pr, Stack } from './types.ts';

/** A merged layer stays part of its stack this long, so a stack does not lose its lower layers the moment they land. */
export const MERGED_LAYER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function byNumber(a: Pr, b: Pr): number {
  return a.ref.number - b.ref.number;
}

/** Open PRs whose base branch is this PR's head branch, lowest number first. */
function childrenOf(parent: Pr, open: Pr[]): Pr[] {
  return open.filter((pr) => pr !== parent && pr.baseRef === parent.headRef).sort(byNumber);
}

function hasParent(pr: Pr, open: Pr[]): boolean {
  return open.some((other) => other !== pr && other.headRef === pr.baseRef);
}

function stacksInRepo(repo: string, open: Pr[]): Stack[] {
  const stacks: Stack[] = [];
  const visited = new Set<Pr>();
  // Fork children start their own chain; see buildStacks for the rule.
  const starts = open.filter((pr) => !hasParent(pr, open)).sort(byNumber);

  while (starts.length > 0) {
    const start = starts.shift() as Pr;
    const chain: Pr[] = [];
    let current: Pr | undefined = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const children: Pr[] = childrenOf(current, open).filter((child) => !visited.has(child));
      current = children[0];
      starts.push(...children.slice(1));
    }
    if (chain.length >= 2 && chain.some((pr) => pr.state === 'OPEN')) {
      stacks.push({ id: `stack:${chain[0]!.key}`, repo, prKeys: chain.map((pr) => pr.key) });
    }
  }
  return stacks;
}

function mergedSince(now: IsoTime | undefined): IsoTime | null {
  return now === undefined ? null : new Date(new Date(now).getTime() - MERGED_LAYER_DAYS * DAY_MS).toISOString();
}

/** Open PRs, and with a `now`, PRs merged in the last MERGED_LAYER_DAYS. */
function isLiveLayer(pr: Pr, since: IsoTime | null): boolean {
  if (pr.state === 'OPEN') {
    return true;
  }
  return since !== null && pr.state === 'MERGED' && pr.mergedAt !== null && pr.mergedAt >= since;
}

/**
 * Finds real stacks: PR B sits on PR A when B.baseRef equals A.headRef in the
 * same repo. Only chains of two or more PRs with at least one open PR count.
 * Closed PRs break a chain; merged ones do too, unless `now` is given and
 * they merged in the last MERGED_LAYER_DAYS.
 *
 * Stacks are linear. When two PRs sit on the same parent, the lowest-numbered
 * one continues the stack and the other starts a separate chain without the
 * parent, so it only becomes a stack if something sits on it in turn.
 */
export function buildStacks(prs: Pr[], now?: IsoTime): Stack[] {
  const since = mergedSince(now);
  const openByRepo = new Map<string, Pr[]>();
  for (const pr of prs) {
    if (!isLiveLayer(pr, since)) {
      continue;
    }
    const list = openByRepo.get(pr.ref.repo) ?? [];
    list.push(pr);
    openByRepo.set(pr.ref.repo, list);
  }
  const stacks: Stack[] = [];
  for (const repo of [...openByRepo.keys()].sort()) {
    stacks.push(...stacksInRepo(repo, openByRepo.get(repo) ?? []));
  }
  return stacks;
}
