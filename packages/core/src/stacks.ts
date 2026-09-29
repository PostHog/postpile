import type { IsoTime, Pr, PrKey, PrRef, PrState, Stack, TopicMembership } from './types.ts';

/**
 * What the stack rules need of a PR. A full snapshot has it, and so does a
 * branch lookup answer, so the sync walks stacks with the same rules.
 */
export interface LayerShape {
  ref: PrRef;
  state: PrState;
  baseRef: string;
  headRef: string;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  mergedAt: IsoTime | null;
  previousBaseRefs?: string[];
}

const STATE_RANK: Record<PrState, number> = { OPEN: 0, MERGED: 1, CLOSED: 2 };

function byNumber(a: LayerShape, b: LayerShape): number {
  return a.ref.number - b.ref.number;
}

/** Open before merged before closed, then the lowest number. */
function byStateThenNumber(a: LayerShape, b: LayerShape): number {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || byNumber(a, b);
}

/**
 * Several PRs can share a head branch (a closed PR opened again as a new
 * one). Only one of them is the layer: open first, then merged, then closed,
 * and the newest of those. Keeps the input order otherwise.
 */
export function oneLayerPerHead<T extends LayerShape>(prs: T[]): T[] {
  const best = new Map<string, T>();
  for (const pr of prs) {
    const key = `${pr.ref.repo}\n${pr.headRef}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, pr);
      continue;
    }
    const rank = STATE_RANK[pr.state] - STATE_RANK[current.state];
    if (rank < 0 || (rank === 0 && pr.ref.number > current.ref.number)) {
      best.set(key, pr);
    }
  }
  const kept = new Set(best.values());
  return prs.filter((pr) => kept.has(pr));
}

/**
 * A merged or closed PR only counts as the layer below a PR that was opened
 * while it was still open. This keeps an old merged PR whose branch name got
 * reused from joining a new stack. A closed PR has no close time here, so
 * its last update stands in (it is never earlier than the close).
 */
function wasOpenWhenOpened(parent: LayerShape, child: LayerShape): boolean {
  if (parent.state === 'OPEN') {
    return true;
  }
  const endedAt = parent.mergedAt ?? parent.updatedAt;
  return endedAt >= child.createdAt;
}

/**
 * `child` sits on `parent`: its base branch is the parent's head branch, or
 * was until the parent merged and GitHub moved it one branch down.
 */
export function sitsOn(child: LayerShape, parent: LayerShape): boolean {
  if (child.ref.repo !== parent.ref.repo || child.ref.number === parent.ref.number) {
    return false;
  }
  const direct = child.baseRef === parent.headRef;
  const movedDown = parent.state === 'MERGED' && (child.previousBaseRefs ?? []).includes(parent.headRef);
  return (direct || movedDown) && wasOpenWhenOpened(parent, child);
}

/** The PR this one sits on. The current base wins over a former one. */
function parentOf(pr: Pr, byHead: Map<string, Pr>): Pr | undefined {
  const refs = [pr.baseRef, ...(pr.previousBaseRefs ?? [])];
  for (const ref of refs) {
    const candidate = byHead.get(ref);
    if (candidate && sitsOn(pr, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function stacksInRepo(repo: string, prs: Pr[]): Stack[] {
  const layers = oneLayerPerHead(prs.filter((pr) => !pr.isCrossRepository));
  const byHead = new Map(layers.map((pr) => [pr.headRef, pr]));
  const children = new Map<Pr, Pr[]>();
  const starts: Pr[] = [];
  for (const pr of layers) {
    const parent = parentOf(pr, byHead);
    if (!parent) {
      starts.push(pr);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(pr);
    children.set(parent, list);
  }
  starts.sort(byNumber);

  const stacks: Stack[] = [];
  const visited = new Set<Pr>();
  while (starts.length > 0) {
    const start = starts.shift() as Pr;
    const chain: Pr[] = [];
    let current: Pr | undefined = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      // Fork children start their own chain; see buildStacks for the rule.
      const next: Pr[] = (children.get(current) ?? []).filter((child) => !visited.has(child)).sort(byStateThenNumber);
      current = next[0];
      starts.push(...next.slice(1));
    }
    if (chain.length >= 2 && chain.some((pr) => pr.state === 'OPEN')) {
      stacks.push({ id: `stack:${chain[0]!.key}`, repo, prKeys: chain.map((pr) => pr.key) });
    }
  }
  return stacks;
}

/**
 * Finds real stacks: PR B sits on PR A when B's base branch is A's head
 * branch in the same repo, or was until A merged (see `sitsOn`). Every
 * layer counts whatever its state: open, draft, merged (at any age) and
 * closed, so a stack always shows whole. Only chains of two or more PRs
 * with at least one open PR are stacks.
 *
 * A PR from a fork is never a layer: its head branch lives in the fork, so
 * a name like main or patch-1 would otherwise take a real layer's place in
 * `oneLayerPerHead` or chain it to an unrelated PR.
 *
 * Stacks are linear. When two PRs sit on the same parent, one continues the
 * stack (open before merged before closed, then the lowest number) and the
 * other starts a separate chain without the parent, so it only becomes a
 * stack if something sits on it in turn. Preferring the open one keeps a
 * closed attempt from taking the place of the open layers that replaced it:
 * those would form a chain of pulled-in PRs only, which no tile shows.
 */
export function buildStacks(prs: Pr[]): Stack[] {
  const byRepo = new Map<string, Pr[]>();
  for (const pr of prs) {
    const list = byRepo.get(pr.ref.repo) ?? [];
    list.push(pr);
    byRepo.set(pr.ref.repo, list);
  }
  const stacks: Stack[] = [];
  for (const repo of [...byRepo.keys()].sort()) {
    stacks.push(...stacksInRepo(repo, byRepo.get(repo) ?? []));
  }
  return stacks;
}

/** The stack of each PR that is a layer of one. */
export function stackByPrKey(stacks: Stack[]): Map<PrKey, Stack> {
  const result = new Map<PrKey, Stack>();
  for (const stack of stacks) {
    for (const key of stack.prKeys) {
      result.set(key, stack);
    }
  }
  return result;
}

/**
 * The one topic a stack shows in. Layers can end up with different topics
 * (assigned before they were known to be one stack, or moved one by one);
 * the newest membership among them wins, since it is the latest decision.
 * Only active topics count while one of them has a layer: a retired topic
 * lists no tiles, so picking it would hide the whole stack even though
 * another layer sits in a topic that shows. With every layer in a retired
 * topic the stack stays with the newest one, like any other PR of it, and
 * comes back when that topic does. Null when no layer has a topic yet.
 */
export function stackTopicId(stack: Stack, memberships: Map<PrKey, TopicMembership>, activeTopicIds: Set<string>): string | null {
  let newest: TopicMembership | null = null;
  let newestActive: TopicMembership | null = null;
  for (const key of stack.prKeys) {
    const membership = memberships.get(key);
    if (!membership) {
      continue;
    }
    if (newest === null || membership.createdAt > newest.createdAt) {
      newest = membership;
    }
    const active = activeTopicIds.has(membership.topicId);
    if (active && (newestActive === null || membership.createdAt > newestActive.createdAt)) {
      newestActive = membership;
    }
  }
  return (newestActive ?? newest)?.topicId ?? null;
}
