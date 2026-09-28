// Repo scope and quiet repos. The title bar's repo menu narrows what the app
// shows to some repos, and a repo can be set to "Let it go stale" (quiet):
// its PRs still sync and feed topic memory, but never make a topic urgent,
// never ping and stay out of the queue and filter counts. Rules only, no IO;
// the engine and FakeEngine call the same functions. DESIGN.md "Repo scope
// and quiet repos".
import { parsePrKey } from './keys.ts';
import type { PrKey } from './types.ts';

/** Kept in meta, changed from the repo menu. Repo names are "owner/name" as GitHub gives them. */
export interface RepoSettings {
  /** Repos the app shows. Null shows every repo ("All repos"). */
  scope: string[] | null;
  /** Repos set to "Let it go stale". */
  quiet: string[];
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = { scope: null, quiet: [] };

/** One row of the repo menu. */
export interface RepoEntry {
  repo: string;
  /** PRs of this repo in some topic's tiles, pulled-in stack layers included. */
  prs: number;
  quiet: boolean;
  /** Checked in the menu: in the scope, or every repo when the scope is "All repos". */
  inScope: boolean;
}

/** GET /api/repos: the menu's rows, most PRs first, plus the stored scope. */
export interface RepoOverview {
  scope: string[] | null;
  repos: RepoEntry[];
}

/** GitHub repo names are case-insensitive. */
function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function listsRepo(list: string[], repo: string): boolean {
  return list.some((entry) => sameRepo(entry, repo));
}

/** "PostHog/posthog#12" -> "PostHog/posthog". */
export function repoOfPr(key: PrKey): string {
  return parsePrKey(key).repo;
}

/**
 * An empty selection means "All repos", so the app never narrows to
 * nothing. Duplicates (any case) are dropped, the first spelling kept.
 */
export function normalizeRepoScope(scope: string[] | null): string[] | null {
  if (scope === null) {
    return null;
  }
  const unique: string[] = [];
  for (const repo of scope.map((entry) => entry.trim()).filter((entry) => entry !== '')) {
    if (!listsRepo(unique, repo)) {
      unique.push(repo);
    }
  }
  return unique.length > 0 ? unique : null;
}

/** Adds or removes a repo from the quiet list. */
export function withQuietRepo(settings: RepoSettings, repo: string, quiet: boolean): RepoSettings {
  const others = settings.quiet.filter((entry) => !sameRepo(entry, repo));
  return { ...settings, quiet: quiet ? [...others, repo] : others };
}

export function isRepoInScope(repo: string, settings: RepoSettings): boolean {
  return settings.scope === null || listsRepo(settings.scope, repo);
}

export function isPrInScope(key: PrKey, settings: RepoSettings): boolean {
  return isRepoInScope(repoOfPr(key), settings);
}

export function isQuietRepo(repo: string, settings: RepoSettings): boolean {
  return listsRepo(settings.quiet, repo);
}

export function isPrInQuietRepo(key: PrKey, settings: RepoSettings): boolean {
  return isQuietRepo(repoOfPr(key), settings);
}

/** A tile shows when one of its PRs is in scope. A set can mix repos; a stack cannot. */
export function isTileInScope(prKeys: PrKey[], settings: RepoSettings): boolean {
  return prKeys.some((key) => isPrInScope(key, settings));
}

/** A tile is quiet when every one of its PRs is in a quiet repo. A tile without PRs is not. */
export function isQuietTile(prKeys: PrKey[], settings: RepoSettings): boolean {
  return prKeys.length > 0 && prKeys.every((key) => isPrInQuietRepo(key, settings));
}

/**
 * The repo menu: every repo with PRs in the tiles, plus the repos the
 * settings name that have none left (so they can still be unchecked or woken
 * up). Most PRs first, then by name. `prKeys` may repeat a PR; it counts once.
 */
export function repoOverview(prKeys: PrKey[], settings: RepoSettings): RepoOverview {
  const counts = new Map<string, number>();
  const spelling = new Map<string, string>();
  const note = (repo: string, add: number) => {
    const id = repo.toLowerCase();
    spelling.set(id, spelling.get(id) ?? repo);
    counts.set(id, (counts.get(id) ?? 0) + add);
  };
  for (const key of new Set(prKeys)) {
    note(repoOfPr(key), 1);
  }
  for (const repo of [...(settings.scope ?? []), ...settings.quiet]) {
    note(repo, 0);
  }
  const repos = [...counts.entries()].map(([id, prs]): RepoEntry => {
    const repo = spelling.get(id)!;
    return { repo, prs, quiet: isQuietRepo(repo, settings), inScope: isRepoInScope(repo, settings) };
  });
  repos.sort((a, b) => b.prs - a.prs || a.repo.localeCompare(b.repo));
  return { scope: settings.scope, repos };
}
