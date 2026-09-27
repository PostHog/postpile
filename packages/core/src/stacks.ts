import type { Pr, Stack } from './types.ts';

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
    if (chain.length >= 2) {
      stacks.push({ id: `stack:${chain[0]!.key}`, repo, prKeys: chain.map((pr) => pr.key) });
    }
  }
  return stacks;
}

/**
 * Finds real stacks: PR B sits on PR A when B.baseRef equals A.headRef in the
 * same repo. Only chains of two or more open PRs count; merged or closed PRs
 * break a chain.
 *
 * Stacks are linear. When two PRs sit on the same parent, the lowest-numbered
 * one continues the stack and the other starts a separate chain without the
 * parent, so it only becomes a stack if something sits on it in turn.
 */
export function buildStacks(prs: Pr[]): Stack[] {
  const openByRepo = new Map<string, Pr[]>();
  for (const pr of prs) {
    if (pr.state !== 'OPEN') {
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
