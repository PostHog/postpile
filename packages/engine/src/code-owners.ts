import { parseCodeowners, type CodeownersRule, type IsoTime } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';

const META_PREFIX = 'code_owners:';

/** CODEOWNERS changes rarely; one read per repo a day is plenty. */
export const CODE_OWNERS_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * One repo's CODEOWNERS as last read. `text` null: the repo has none, the
 * token cannot see it, or GitHub did not hand back the whole file; then
 * nothing is said about ownership.
 */
interface StoredCodeOwners {
  fetchedAt: IsoTime;
  path: string | null;
  /** The blob SHA; the same text has the same oid. */
  oid: string | null;
  text: string | null;
}

function metaKey(repo: string): string {
  return `${META_PREFIX}${repo.toLowerCase()}`;
}

function loadStored(store: Store, repo: string): StoredCodeOwners | null {
  const raw = store.meta.get(metaKey(repo));
  return raw ? (JSON.parse(raw) as StoredCodeOwners) : null;
}

/** The repo's CODEOWNERS rules as stored, no GitHub call. Null when unknown or unreadable: say nothing then. */
export function loadCodeOwnersRules(store: Store, repo: string): CodeownersRule[] | null {
  const text = loadStored(store, repo)?.text ?? null;
  return text === null ? null : parseCodeowners(text);
}

/**
 * Each repo's CODEOWNERS (DESIGN.md "Review ownership"), kept in meta per
 * repo so reads, the MCP server and offline starts have it. Read for the
 * repos of open PRs, at most once a day per repo, all due repos in one
 * GraphQL query (a batch per CODE_OWNERS_BATCH_SIZE repos).
 */
export class CodeOwnersKeeper {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
  ) {}

  private isDue(repo: string): boolean {
    const stored = loadStored(this.store, repo);
    return !stored || this.now().getTime() - new Date(stored.fetchedAt).getTime() >= CODE_OWNERS_REFRESH_MS;
  }

  /**
   * Reads the due repos' CODEOWNERS and stores what came back; a repo the
   * token cannot see is stored as unreadable too, so it waits a day like
   * the rest. Throws on a failed request: nothing is stored then and the
   * next sync tries again. Answers the repos it read.
   */
  async refresh(repos: string[]): Promise<string[]> {
    const due = [...new Set(repos.map((repo) => repo.toLowerCase()))].filter((repo) => this.isDue(repo)).sort();
    if (due.length === 0) {
      return [];
    }
    const files = await this.reader.codeOwnersFiles(due);
    const fetchedAt = this.now().toISOString();
    for (const repo of due) {
      const file = files.get(repo) ?? null;
      const stored: StoredCodeOwners = { fetchedAt, path: file?.path ?? null, oid: file?.oid ?? null, text: file?.text ?? null };
      this.store.meta.set(metaKey(repo), JSON.stringify(stored));
    }
    return due;
  }
}
