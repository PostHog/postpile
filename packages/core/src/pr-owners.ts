// Whose PR it is. Usually the author, but an agent PR opened by a GitHub App
// on someone's behalf belongs to the person it is assigned to (2026-09-30).
// Every rule about "the viewer wrote this PR" or "a teammate wrote this PR"
// asks here; showing who opened the PR still reads `pr.author`.
import { isBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import type { Pr } from './types.ts';

type OwnedPr = Pick<Pr, 'author' | 'assignees'>;

/**
 * The PR's owners: its author, except when the author is a bot and the PR
 * has assignees; then the assignees. A human author stays the only owner
 * even with assignees, and a bot PR without assignees stays the bot's.
 */
export function prOwners(pr: OwnedPr): string[] {
  const assignees = pr.assignees ?? [];
  if (isBot(pr.author) && assignees.length > 0) {
    return assignees;
  }
  return [pr.author];
}

/** `login` is one of the PR's owners (`prOwners`). */
export function isPrOwner(pr: OwnedPr, login: string): boolean {
  return prOwners(pr).some((owner) => sameLogin(owner, login));
}

/** The owner a sentence names ("alice to merge"): the first of `prOwners`. */
export function prOwner(pr: OwnedPr): string {
  return prOwners(pr)[0] ?? pr.author;
}
