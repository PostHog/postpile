// `pnpm cli branches`: PR signals for session-first tools, straight from the
// store. Reads only the candidate PRs (own or reviewed, in the window), never
// every topic's detail, and makes no GitHub or agent call.
import { branchesSince, branchesView, type BranchesOptions, type BranchesView, type BranchInput } from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer } from './viewer-meta.ts';

export function readBranches(store: Store, now: Date, options: BranchesOptions): BranchesView {
  const viewer = loadViewer(store);
  if (viewer === null) {
    throw new Error('PostPile does not know its user yet: run a sync first');
  }
  const keys = store.prs.branchCandidateKeys(viewer.login, branchesSince(now, options.days), options.repo);
  const prs = store.prs.getMany(keys);
  const events = store.events.listForPrs(keys);
  const userStates = store.userPrStates.getMany(keys);
  const fetchedAt = store.prs.fetchedAtByKey();
  const inputs: BranchInput[] = [];
  for (const key of keys) {
    const pr = prs.get(key);
    if (pr) {
      inputs.push({ pr, events: events.get(key) ?? [], userState: userStates.get(key) ?? null, fetchedAt: fetchedAt.get(key) ?? null });
    }
  }
  return branchesView(inputs, viewer, now, options);
}
