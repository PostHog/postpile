// CODEOWNERS (DESIGN.md "Review ownership"): which of a PR's files pull in a
// team's review, and how big the viewer's part of it is. GitHub's rules: the
// last matching line wins; patterns are gitignore-style (`*`, `**`, a
// trailing `/` for a directory, a leading `/` or an inner `/` anchors to the
// repo root) without `!` negation, `[ ]` ranges or `\` escapes, and GitHub
// skips lines that use them; owners are "@org/team" or "@user" (emails are
// dropped here). Rules only, no IO.
import { isBot } from './bots.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { homeTeamsOf } from './team-roles.ts';
import type { Pr, PrFile, Viewer } from './types.ts';

export interface CodeownersRule {
  /** The pattern as written. */
  pattern: string;
  /** Lower case, without "@": "org/team-slug" or a login. Empty: the line takes ownership away. */
  owners: string[];
  regex: RegExp;
}

/** Files one owner holds among the PR's listed files. */
export interface OwnedFiles {
  /** As asked: "org/team-slug" (a requested or home team). */
  owner: string;
  /** A team asked to review on the PR right now. */
  requested: boolean;
  files: PrFile[];
}

/** `reviewOwnership`: the PR's files as CODEOWNERS hands them out. */
export interface ReviewOwnership {
  /**
   * The requested teams (even when they own none of the files: then the
   * request did not come from CODEOWNERS), then the viewer's home teams
   * that own at least one file.
   */
  owners: OwnedFiles[];
  /** Files owned by the viewer's part: their home teams, their requested teams and their own login. Each file once. */
  yours: PrFile[];
  /** Files compared: the stored list, which the reader caps at 100. */
  filesListed: number;
  /** The PR's changed-file count from GitHub; more than `filesListed` when the list is capped. */
  filesTotal: number;
}

const UNSUPPORTED = /[![\]\\]/;

function hasWildcard(segment: string): boolean {
  return segment.includes('*') || segment.includes('?');
}

/** One path segment: `*` and `?` stay inside it. */
function segmentSource(segment: string): string {
  let source = '';
  for (const char of segment) {
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      // Every regex special, even ones `codeownersPatternRegex` already refuses, so the escape stands on its own.
      source += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return source;
}

/**
 * The pattern as a regex over a repo path ("src/app.ts", no leading slash).
 * A pattern that names a file or directory also covers everything under
 * it, except when its last segment has a wildcard: GitHub's `docs/*` owns
 * docs/a.md but not docs/build/b.md. Null for a line GitHub skips.
 */
export function codeownersPatternRegex(pattern: string): RegExp | null {
  if (UNSUPPORTED.test(pattern)) {
    return null;
  }
  const dirOnly = pattern.endsWith('/');
  let body = dirOnly ? pattern.slice(0, -1) : pattern;
  const anchored = body.includes('/');
  if (body.startsWith('/')) {
    body = body.slice(1);
  }
  if (body === '') {
    return null;
  }
  const segments = body.split('/');
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:.*/)?';
    } else {
      source += segmentSource(segment) + (last ? '' : '/');
    }
  });
  const lastSegment = segments[segments.length - 1] ?? '';
  let suffix = '(?:/.*)?';
  if (dirOnly) {
    suffix = '/.*';
  } else if (lastSegment === '**' || hasWildcard(lastSegment)) {
    suffix = '';
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}${suffix}$`);
}

/** Every rule of a CODEOWNERS file, in file order. Comments, blank lines and lines GitHub skips are left out. */
export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const [pattern = '', ...rest] = line.split(/\s+/);
    const regex = codeownersPatternRegex(pattern);
    if (!regex) {
      continue;
    }
    const owners: string[] = [];
    for (const token of rest) {
      if (token.startsWith('#')) {
        break;
      }
      if (token.startsWith('@') && token.length > 1) {
        owners.push(token.slice(1).toLowerCase());
      }
    }
    rules.push({ pattern, owners, regex });
  }
  return rules;
}

/** The owners of one path: the last matching rule's. Empty when no rule matches. */
export function ownersOfPath(rules: CodeownersRule[], path: string): string[] {
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]!;
    if (rule.regex.test(path)) {
      return rule.owners;
    }
  }
  return [];
}

/** A CODEOWNERS owner is `team` ("org/slug", or the bare slug a review request sometimes carries). */
function isTeamOwner(owner: string, team: string): boolean {
  const wanted = team.toLowerCase();
  return owner === wanted || (!wanted.includes('/') && owner.endsWith(`/${wanted}`));
}

/** Files whose owners include one that `matches`. */
function ownedBy(fileOwners: Map<PrFile, string[]>, matches: (owner: string) => boolean): PrFile[] {
  return [...fileOwners].filter(([, owners]) => owners.some(matches)).map(([file]) => file);
}

type OwnershipPr = Pick<Pr, 'files' | 'changedFiles' | 'reviewerTeams'>;

/**
 * The PR's listed files as CODEOWNERS hands them out, for the requested
 * teams and the viewer's home teams. The viewer's part (`yours`) is what
 * their home teams, their teams asked on this PR and their own login own.
 * Null when the PR changed files but none are stored (a snapshot without
 * its file list): nothing to say then.
 */
export function reviewOwnership(rules: CodeownersRule[], pr: OwnershipPr, viewer: Viewer | null): ReviewOwnership | null {
  if (pr.files.length === 0 && pr.changedFiles > 0) {
    return null;
  }
  const fileOwners = new Map(pr.files.map((file) => [file, ownersOfPath(rules, file.path)]));
  const home = viewer ? homeTeamsOf(viewer) : [];
  const ownedByTeam = (team: string) => ownedBy(fileOwners, (owner) => isTeamOwner(owner, team));
  const owners: OwnedFiles[] = pr.reviewerTeams.map((team) => ({ owner: team, requested: true, files: ownedByTeam(team) }));
  for (const team of home) {
    // A requested bare slug and the home team's "org/slug" are one team.
    if (owners.some((entry) => isOwnTeam(entry.owner, [team]))) {
      continue;
    }
    const files = ownedByTeam(team);
    if (files.length > 0) {
      owners.push({ owner: team, requested: false, files });
    }
  }
  const viewerTeams = viewer?.teams ?? [];
  const myTeams = [...home, ...pr.reviewerTeams.filter((team) => isOwnTeam(team, viewerTeams))];
  // The viewer's login only ever matches a user owner exactly: "@org/<login>" is a team, not them.
  const isMine = (owner: string) => myTeams.some((team) => isTeamOwner(owner, team)) || (viewer !== null && owner === viewer.login.toLowerCase());
  const yours = ownedBy(fileOwners, isMine);
  return { owners, yours, filesListed: pr.files.length, filesTotal: Math.max(pr.changedFiles, pr.files.length) };
}

/**
 * Unresolved review threads the viewer is in (they wrote a comment in it)
 * or that wait on them: on their own PR, a thread whose last word is
 * someone else's and not a bot's.
 */
export function viewerOpenThreads(pr: Pick<Pr, 'threads' | 'author' | 'assignees'>, login: string): number {
  const ownPr = isPrOwner(pr, login);
  return pr.threads.filter((thread) => {
    if (thread.isResolved) {
      return false;
    }
    if (thread.comments.some((comment) => sameLogin(comment.author, login))) {
      return true;
    }
    const last = thread.comments[thread.comments.length - 1];
    return ownPr && last !== undefined && !isBot(last.author);
  }).length;
}

/** Added and deleted lines over some files. */
export function fileLines(files: PrFile[]): { additions: number; deletions: number } {
  return files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });
}
