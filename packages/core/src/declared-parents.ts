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

/**
 * "#12", "acme/app#12" or a pull URL; spaces, a colon, a markdown link's "["
 * and bold or italic marks may sit in between. Bounded, so no input makes
 * the match slow.
 */
const REFERENCE = String.raw`[\s*_:\[]{0,12}(?:https?://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|([\w.-]+/[\w.-]+)?#(\d+))`;

/**
 * The body without HTML comments (PR templates keep their examples there).
 * An unclosed comment hides the rest, as on GitHub. A plain scan, not a
 * regex: a lazy match over many unclosed "<!--" takes quadratic time.
 */
function withoutComments(body: string): string {
  let result = '';
  let from = 0;
  for (;;) {
    const start = body.indexOf('<!--', from);
    if (start < 0) {
      return result + body.slice(from);
    }
    result += `${body.slice(from, start)} `;
    const end = body.indexOf('-->', start + 4);
    if (end < 0) {
      return result;
    }
    from = end + 3;
  }
}

/** One run of backticks: where it starts and how long it is. */
interface BacktickRun {
  start: number;
  length: number;
}

function backtickRuns(text: string): BacktickRun[] {
  const runs: BacktickRun[] = [];
  let index = text.indexOf('`');
  while (index >= 0) {
    let end = index;
    while (text[end] === '`') {
      end++;
    }
    runs.push({ start: index, length: end - index });
    index = text.indexOf('`', end);
  }
  return runs;
}

/**
 * The text without Markdown code spans: a run of N backticks opens one and
 * the next run of exactly N closes it ("``depends on #3``" is code too). A
 * run with no closing partner is plain text. Each run's partner is found
 * in one pass from the end, so many unmatched runs stay linear.
 */
function withoutCodeSpans(text: string): string {
  const runs = backtickRuns(text);
  const partner: (number | null)[] = runs.map(() => null);
  const nextByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index]!.length;
    partner[index] = nextByLength.get(length) ?? null;
    nextByLength.set(length, index);
  }
  let result = '';
  let from = 0;
  let index = 0;
  while (index < runs.length) {
    const close = partner[index];
    if (close === null || close === undefined) {
      index++;
      continue;
    }
    const open = runs[index]!;
    const closing = runs[close]!;
    result += `${text.slice(from, open.start)} `;
    from = closing.start + closing.length;
    index = close + 1;
  }
  return result + text.slice(from);
}

/**
 * Text a body shows that is no claim of its own: HTML comments, fenced
 * code (an unclosed fence runs to the end, as on GitHub), quoted lines
 * and code spans. Every step is a linear scan.
 */
function withoutQuotedText(body: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of withoutComments(body).split('\n')) {
    const marker = /^ {0,3}(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence !== null) {
      if (marker === fence) {
        fence = null;
      }
      continue;
    }
    if (marker !== null) {
      fence = marker;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return withoutCodeSpans(kept.join('\n'));
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
