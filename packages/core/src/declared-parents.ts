import type { Pr, PrRef, PrState } from './types.ts';

/**
 * Stacks declared in a PR body (DESIGN.md "Stacks declared in the body").
 * Some stacking tools and people open every layer against the default
 * branch and write "Stacked on #12" in the body instead of basing the PR
 * on the layer below. Branches then say nothing about the stack; the body
 * does.
 */

/** "stacked on", "stacked on top of", "depends on", "based on", in any case. */
const PHRASE = String.raw`\b(?:stacked\s+on(?:\s+top\s+of)?|depends\s+on|based\s+on)`;

/** "#12", "acme/app#12" or a pull URL; a markdown link's "[" and bold or italic marks may sit around it. */
const REFERENCE = String.raw`[*_]*\s*:?\s*[*_]*\s*\[?\s*(?:https?://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|([\w.-]+/[\w.-]+)?#(\d+))`;

/**
 * Text a body shows that is no claim of its own: fenced code, inline code,
 * HTML comments (PR templates keep their examples there) and quoted lines.
 */
function withoutQuotedText(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^ {0,3}>.*$/gm, ' ');
}

/**
 * The PR numbers a body declares as the layer below, in the order they
 * appear: "Stacked on #12", "depends on acme/app#12", "based on
 * https://github.com/acme/app/pull/12". Only PRs in the same repo count
 * (compared ignoring case), never the PR itself, each number once. Code,
 * HTML comments and quoted lines are skipped.
 */
export function declaredParents(body: string, ref: PrRef): number[] {
  const pattern = new RegExp(PHRASE + REFERENCE, 'gi');
  const repo = ref.repo.toLowerCase();
  const numbers: number[] = [];
  for (const match of withoutQuotedText(body).matchAll(pattern)) {
    const otherRepo = match[1] ?? match[3];
    const number = Number(match[2] ?? match[4]);
    if (otherRepo !== undefined && otherRepo.toLowerCase() !== repo) {
      continue;
    }
    if (number === ref.number || numbers.includes(number)) {
      continue;
    }
    numbers.push(number);
  }
  return numbers;
}

/**
 * The layer below an open PR's body declares: the first one it names.
 * Stacks are linear, so only one counts. Null for a merged or closed PR:
 * once it merged it has landed its parent too, and a closed one stacks on
 * nothing.
 */
export function declaredParentOf(pr: { ref: PrRef; state: PrState; body: string }): number | null {
  if (pr.state !== 'OPEN') {
    return null;
  }
  return declaredParents(pr.body, pr.ref)[0] ?? null;
}

/** What the glance prompt says about a PR whose body declares the layer below (`declaredParentNote`). */
export interface DeclaredParentNote {
  number: number;
  /** "open", "draft", "merged" or "closed". */
  state: string;
  /** This PR's commits, as far as the stored snapshot lists them. */
  commits: number;
  /** How many of those the parent has too: they come from the parent. */
  sharedCommits: number;
  /** This PR's changed files the parent changes too, in this PR's order. */
  sharedFiles: string[];
}

function stateWord(pr: Pick<Pr, 'state' | 'isDraft'>): string {
  if (pr.state === 'OPEN') {
    return pr.isDraft ? 'draft' : 'open';
  }
  return pr.state === 'MERGED' ? 'merged' : 'closed';
}

/**
 * What the child's diff likely owes its declared parent: commits both
 * list (a stacked branch carries the parent's commits) and the files both
 * change. Cheap, from the stored snapshots; capped commit lists make it
 * a lower bound.
 */
export function declaredParentNote(child: Pick<Pr, 'commits' | 'files'>, parent: Pick<Pr, 'ref' | 'state' | 'isDraft' | 'commits' | 'files'>): DeclaredParentNote {
  const parentCommits = new Set(parent.commits.map((commit) => commit.oid));
  const parentFiles = new Set(parent.files.map((file) => file.path));
  return {
    number: parent.ref.number,
    state: stateWord(parent),
    commits: child.commits.length,
    sharedCommits: child.commits.filter((commit) => parentCommits.has(commit.oid)).length,
    sharedFiles: child.files.map((file) => file.path).filter((path) => parentFiles.has(path)),
  };
}
