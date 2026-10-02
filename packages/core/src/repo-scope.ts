// Repo scope and quiet repos. The title bar's repo menu picks "All repos" or
// one repo. The chosen repo only selects topics: the sidebar lists topics
// with at least one PR in it, and an opened topic always shows all of its
// tiles, with a small repo label on the ones from another repo. A repo can be
// set to "Let it go stale" (quiet): its PRs still sync and feed topic memory,
// but never make a topic urgent, never ping and stay out of the queue and
// filter counts. Rules only, no IO; the engine and FakeEngine call the same
// functions. DESIGN.md "Repo scope and quiet repos".
import { parsePrKey } from './keys.ts';
import type { PrKey } from './types.ts';
import type { TopicRepoLine } from './views.ts';

/** Kept in meta, changed from the repo menu. Repo names are "owner/name" as GitHub gives them. */
export interface RepoSettings {
  /** The one repo whose topics the sidebar lists. Null lists every topic ("All repos"). */
  scope: string | null;
  /** Repos set to "Let it go stale". */
  quiet: string[];
}

/**
 * For reads that list topics. allRepos ignores the title bar's repo choice:
 * the MCP server answers other agents about any repo, whatever the window
 * shows. Quiet repos stay quiet either way.
 */
export interface ListScope {
  allRepos?: boolean;
}

/** The settings a read filters by: the chosen scope, or all repos. */
export function scopedSettings(settings: RepoSettings, scope: ListScope = {}): RepoSettings {
  return scope.allRepos ? { ...settings, scope: null } : settings;
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = { scope: null, quiet: [] };

/** One row of the repo menu. */
export interface RepoEntry {
  repo: string;
  /** Topics with at least one PR of this repo: what the sidebar lists when it is chosen. */
  topics: number;
  /** PRs of this repo in some topic's tiles, pulled-in stack layers included. */
  prs: number;
  quiet: boolean;
  /** The chosen repo. False for every row under "All repos". */
  selected: boolean;
}

/** GET /api/repos: the menu's rows, most topics first, plus the stored choice. */
export interface RepoOverview {
  scope: string | null;
  /** Topics with at least one PR: what the sidebar lists under "All repos". */
  topics: number;
  repos: RepoEntry[];
}

/** GitHub repo and org names are case-insensitive. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function listsName(list: string[], name: string): boolean {
  return list.some((entry) => sameName(entry, name));
}

/** "acme/app#12" -> "acme/app". */
export function repoOfPr(key: PrKey): string {
  return parsePrKey(key).repo;
}

/** A blank choice is "All repos". */
export function normalizeRepoScope(repo: string | null): string | null {
  const trimmed = repo?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The stored scope, read from any version. Before the single choice the
 * scope was a list: one entry becomes that repo, several (or none) "All
 * repos", since there is no fair way to pick one of them.
 */
export function migrateRepoScope(stored: unknown): string | null {
  if (typeof stored === 'string') {
    return normalizeRepoScope(stored);
  }
  if (Array.isArray(stored) && stored.length === 1 && typeof stored[0] === 'string') {
    return normalizeRepoScope(stored[0]);
  }
  return null;
}

/** Adds or removes a repo from the quiet list. */
export function withQuietRepo(settings: RepoSettings, repo: string, quiet: boolean): RepoSettings {
  const others = settings.quiet.filter((entry) => !sameName(entry, repo));
  return { ...settings, quiet: quiet ? [...others, repo] : others };
}

export function isQuietRepo(repo: string, settings: RepoSettings): boolean {
  return listsName(settings.quiet, repo);
}

export function isPrInQuietRepo(key: PrKey, settings: RepoSettings): boolean {
  return isQuietRepo(repoOfPr(key), settings);
}

/** A tile is quiet when every one of its PRs is in a quiet repo. A tile without PRs is not. */
export function isQuietTile(prKeys: PrKey[], settings: RepoSettings): boolean {
  return prKeys.length > 0 && prKeys.every((key) => isPrInQuietRepo(key, settings));
}

/** The sidebar lists a topic when one of its PRs (any tile) is in the chosen repo, or always under "All repos". */
export function isTopicInScope(topicPrKeys: PrKey[], settings: RepoSettings): boolean {
  const scope = settings.scope;
  if (scope === null) {
    return true;
  }
  return topicPrKeys.some((key) => sameName(repoOfPr(key), scope));
}

interface RepoCount {
  repo: string;
  prs: number;
}

/** Each repo of the PRs with how many it holds, first seen first. A key listed twice counts once. */
function repoCounts(prKeys: PrKey[]): RepoCount[] {
  const counts = new Map<string, RepoCount>();
  for (const key of new Set(prKeys)) {
    const repo = repoOfPr(key);
    const entry = counts.get(repo.toLowerCase()) ?? { repo, prs: 0 };
    entry.prs += 1;
    counts.set(repo.toLowerCase(), entry);
  }
  return [...counts.values()];
}

/** The repo with most of the topic's PRs; a tie goes to the one seen first. Null without PRs. */
export function mainRepoOf(topicPrKeys: PrKey[]): string | null {
  let main: RepoCount | null = null;
  for (const entry of repoCounts(topicPrKeys)) {
    if (main === null || entry.prs > main.prs) {
      main = entry;
    }
  }
  return main?.repo ?? null;
}

/** ["acme/team-platform"] -> ["acme"]: the orgs a repo label leaves out. Works on repo names too. */
export function viewerOrgs(teams: string[]): string[] {
  const orgs: string[] = [];
  for (const team of teams) {
    const org = team.split('/')[0] ?? '';
    if (org !== '' && !listsName(orgs, org)) {
      orgs.push(org);
    }
  }
  return orgs;
}

/** "acme/infra" -> "infra" when acme is one of the viewer's orgs, else the full name. */
export function repoLabel(repo: string, orgs: string[]): string {
  const slash = repo.indexOf('/');
  if (slash < 0) {
    return repo;
  }
  return listsName(orgs, repo.slice(0, slash)) ? repo.slice(slash + 1) : repo;
}

/**
 * What an opened topic's tiles are compared against for the repo label: the
 * chosen repo, or under "All repos" the topic's main repo.
 */
export function labelBaseRepo(topicPrKeys: PrKey[], settings: RepoSettings): string | null {
  return settings.scope ?? mainRepoOf(topicPrKeys);
}

/**
 * The repo on an opened topic's owner line: its main repo (`mainRepoOf`),
 * how many others it touches, and whether it is listed under the picked
 * repo only for a few PRs while most sit elsewhere ("mostly in infra").
 * On a tie the picked repo is the main one, since "mostly in" would not be
 * true. `orgs` is `viewerOrgs`, with the same fallback as `tileRepoLabels`.
 * Null for a topic without PRs.
 */
export function topicRepoLine(topicPrKeys: PrKey[], settings: RepoSettings, orgs: string[]): TopicRepoLine | null {
  const counts = repoCounts(topicPrKeys);
  if (counts.length === 0) {
    return null;
  }
  const scope = settings.scope;
  const picked = scope === null ? undefined : counts.find((entry) => sameName(entry.repo, scope));
  const most = Math.max(...counts.map((entry) => entry.prs));
  const main = picked?.prs === most ? picked : counts.find((entry) => entry.prs === most)!;
  const homeOrgs = orgs.length > 0 ? orgs : viewerOrgs([main.repo]);
  return {
    label: repoLabel(main.repo, homeOrgs),
    otherRepos: counts.length - 1,
    repos: [main, ...counts.filter((entry) => entry !== main)].map((entry) => entry.repo),
    offScope: picked !== undefined && picked !== main,
    pickedLabel: scope === null ? null : repoLabel(scope, homeOrgs),
    pickedPrs: picked?.prs ?? 0,
  };
}

/** A tile's repo labels: on the tile or on single PR rows (same order as `prKeys`), null where none shows. */
export interface TileRepoLabels {
  tile: string | null;
  prs: (string | null)[];
}

/**
 * A tile whose PRs all sit in one other repo gets the label once, on the
 * tile. A set mixing repos gets it on each PR row from another repo instead.
 * `orgs` is `viewerOrgs`; when empty, the base repo's org counts as the
 * viewer's so the label stays short.
 */
export function tileRepoLabels(prKeys: PrKey[], baseRepo: string | null, orgs: string[]): TileRepoLabels {
  const none: TileRepoLabels = { tile: null, prs: prKeys.map(() => null) };
  if (baseRepo === null || prKeys.length === 0) {
    return none;
  }
  const homeOrgs = orgs.length > 0 ? orgs : viewerOrgs([baseRepo]);
  const repos = prKeys.map(repoOfPr);
  const first = repos[0]!;
  if (repos.every((repo) => sameName(repo, first))) {
    return sameName(first, baseRepo) ? none : { tile: repoLabel(first, homeOrgs), prs: none.prs };
  }
  return { tile: null, prs: repos.map((repo) => (sameName(repo, baseRepo) ? null : repoLabel(repo, homeOrgs))) };
}

/**
 * The repo menu: every repo with PRs in some topic, with how many topics
 * and PRs it has, plus the repos the settings name that have none left (so
 * they can still be picked away from or woken up). Most topics first, then
 * PRs, then name. `topicsPrKeys` holds each listed topic's PR keys; a PR in
 * two tiles counts once.
 */
export function repoOverview(topicsPrKeys: PrKey[][], settings: RepoSettings): RepoOverview {
  const rows = new Map<string, { repo: string; topics: number; prs: Set<PrKey> }>();
  const rowOf = (repo: string) => {
    const id = repo.toLowerCase();
    const row = rows.get(id) ?? { repo, topics: 0, prs: new Set<PrKey>() };
    rows.set(id, row);
    return row;
  };
  let topics = 0;
  for (const keys of topicsPrKeys) {
    if (keys.length > 0) {
      topics += 1;
    }
    const counted = new Set<string>();
    for (const key of keys) {
      const row = rowOf(repoOfPr(key));
      row.prs.add(key);
      if (!counted.has(row.repo)) {
        counted.add(row.repo);
        row.topics += 1;
      }
    }
  }
  const named = settings.scope === null ? settings.quiet : [settings.scope, ...settings.quiet];
  for (const repo of named) {
    rowOf(repo);
  }
  const scope = settings.scope;
  const repos = [...rows.values()].map(
    (row): RepoEntry => ({
      repo: row.repo,
      topics: row.topics,
      prs: row.prs.size,
      quiet: isQuietRepo(row.repo, settings),
      selected: scope !== null && sameName(row.repo, scope),
    }),
  );
  repos.sort((a, b) => b.topics - a.topics || b.prs - a.prs || a.repo.localeCompare(b.repo));
  return { scope, topics, repos };
}
