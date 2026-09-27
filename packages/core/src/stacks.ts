import type { Pr, Stack } from './types.ts';

/**
 * Finds real stacks: PR B sits on PR A when B.baseRef equals A.headRef in the
 * same repo. Only chains of two or more open PRs count.
 */
export function buildStacks(_prs: Pr[]): Stack[] {
  throw new Error('not implemented');
}
