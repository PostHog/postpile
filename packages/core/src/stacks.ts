import type { IsoTime, PrKey, PrRef, PrState, Stack, TopicMembership } from './types.ts';

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
  /**
   * The layer below the body declares (`declaredParentOf`): a PR number in
   * the same repo. "Depends on #N" only counts once the two PRs share a
   * commit. Null or missing when it declares none.
   */
  declaredParent?: number | null;
  /**
   * The PR the body says must merge first ("depends on #N") while no shared
   * commit makes it the layer below: a merge order, never a stack link.
   */
  dependsOn?: number | null;
}

/**
 * A stored PR as stack detection reads it: a full snapshot, or its header
 * (`PrRepo.listHeaders`), so stacks over every stored PR never parse the
 * snapshots.
 */
export interface StackLayer extends LayerShape {
  key: PrKey;
  isCrossRepository?: boolean;
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

/**
 * `child` declares `parent` in its body as the layer below
 * (`declaredParentOf`). It counts like a branch link, with the same rule
 * that a merged or closed parent only counts below a PR opened while it
 * was open. Callers try it only when no branch link exists.
 */
export function declaresParent(child: LayerShape, parent: LayerShape): boolean {
  if (child.ref.repo !== parent.ref.repo || child.ref.number === parent.ref.number) {
    return false;
  }
  return child.declaredParent === parent.ref.number && wasOpenWhenOpened(parent, child);
}

/** Whether walking down from `from` through `parents` reaches `target`: linking target onto from would close a loop. */
function reaches<T>(from: T, target: T, parents: Map<T, T>): boolean {
  const seen = new Set<T>();
  let current: T | undefined = from;
  while (current !== undefined && !seen.has(current)) {
    if (current === target) {
      return true;
    }
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}

/** The PR this one sits on. The current base wins over a former one. */
function parentOf<T extends StackLayer>(pr: T, byHead: Map<string, T>): T | undefined {
  const refs = [pr.baseRef, ...(pr.previousBaseRefs ?? [])];
  for (const ref of refs) {
    const candidate = byHead.get(ref);
    if (candidate && sitsOn(pr, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * The layer below each PR: its branch parent (`parentOf`), else the parent
 * its body declares (`declaresParent`). Branch links win. A declared link
 * that would close a loop is dropped; they are tried lowest number first,
 * so the outcome does not depend on the input order. `declared` collects
 * the PRs whose link comes from their body.
 */
function parentsInRepo<T extends StackLayer>(layers: T[], declared: Set<T>): Map<T, T> {
  const byHead = new Map(layers.map((pr) => [pr.headRef, pr]));
  const byNumberInRepo = new Map(layers.map((pr) => [pr.ref.number, pr]));
  const parents = new Map<T, T>();
  for (const pr of layers) {
    const parent = parentOf(pr, byHead);
    if (parent) {
      parents.set(pr, parent);
    }
  }
  for (const pr of [...layers].sort(byNumber)) {
    if (parents.has(pr) || pr.declaredParent === null || pr.declaredParent === undefined) {
      continue;
    }
    const parent = byNumberInRepo.get(pr.declaredParent);
    if (parent && declaresParent(pr, parent) && !reaches(parent, pr, parents)) {
      parents.set(pr, parent);
      declared.add(pr);
    }
  }
  return parents;
}

function stacksInRepo<T extends StackLayer>(repo: string, prs: T[]): Stack[] {
  const layers = oneLayerPerHead(prs.filter((pr) => !pr.isCrossRepository));
  const declared = new Set<T>();
  const parents = parentsInRepo(layers, declared);
  const children = new Map<T, T[]>();
  const starts: T[] = [];
  for (const pr of layers) {
    const parent = parents.get(pr);
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
  const visited = new Set<T>();
  while (starts.length > 0) {
    const start = starts.shift() as T;
    const chain: T[] = [];
    let current: T | undefined = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      // Fork children start their own chain; see buildStacks for the rule.
      const next: T[] = (children.get(current) ?? []).filter((child) => !visited.has(child)).sort(byStateThenNumber);
      current = next[0];
      starts.push(...next.slice(1));
    }
    if (chain.length >= 2 && chain.some((pr) => pr.state === 'OPEN')) {
      const stack: Stack = { id: `stack:${chain[0]!.key}`, repo, prKeys: chain.map((pr) => pr.key) };
      const declaredLinks = chain.slice(1).filter((pr) => declared.has(pr));
      if (declaredLinks.length > 0) {
        stack.declaredLinks = declaredLinks.map((pr) => pr.key);
      }
      stacks.push(stack);
    }
  }
  return stacks;
}

/**
 * Finds real stacks: PR B sits on PR A when B's base branch is A's head
 * branch in the same repo, or was until A merged (see `sitsOn`). Without
 * such a branch link, B's body can declare A as the layer below
 * ("Stacked on #A", `declaresParent`); the stack then lists B in
 * `declaredLinks`. Every
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
export function buildStacks<T extends StackLayer>(prs: T[]): Stack[] {
  const byRepo = new Map<string, T[]>();
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
