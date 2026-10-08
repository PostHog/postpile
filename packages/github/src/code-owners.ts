// CODEOWNERS reads (DESIGN.md "Review ownership"). One aliased GraphQL query
// asks a batch of repos for all three places GitHub looks, so a day's
// refresh of every repo on the board is usually a single request.

/** Where GitHub looks for CODEOWNERS, in its order: the first found wins. */
export const CODE_OWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

/** Repos aliased per query; each asks three small blobs. */
export const CODE_OWNERS_BATCH_SIZE = 30;

/** One repo's CODEOWNERS from its default branch. */
export interface CodeOwnersFile {
  path: string;
  /** The blob SHA: the same text has the same oid. */
  oid: string;
  /** Null when GitHub did not hand back the whole text (binary or too big). */
  text: string | null;
}

interface RawBlob {
  oid: string;
  text: string | null;
  isTruncated: boolean;
}

/** Keyed by alias r0, r1, ...; each repo by f0, f1, f2 (CODE_OWNERS_PATHS order). Null for a repo the token cannot see. */
export type RawCodeOwnersResponse = Record<string, Record<string, RawBlob | null> | null>;

export function codeOwnersAlias(index: number): string {
  return `r${index}`;
}

export function buildCodeOwnersQuery(repos: string[]): string {
  const files = CODE_OWNERS_PATHS.map((path, index) => `f${index}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { oid text isTruncated } }`).join(' ');
  const lines = repos.map((repo, index) => {
    const [owner = '', name = ''] = repo.split('/');
    return `  ${codeOwnersAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${files} }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

/**
 * Each answered repo's first CODEOWNERS, or null when it has none. A repo
 * whose alias is null (not visible, gone) is left out of the map.
 */
export function codeOwnersFiles(repos: string[], data: RawCodeOwnersResponse | null): Map<string, CodeOwnersFile | null> {
  const result = new Map<string, CodeOwnersFile | null>();
  repos.forEach((repo, index) => {
    const raw = data?.[codeOwnersAlias(index)];
    if (!raw) {
      return;
    }
    let found: CodeOwnersFile | null = null;
    for (const [fileIndex, path] of CODE_OWNERS_PATHS.entries()) {
      const blob = raw[`f${fileIndex}`];
      // `object` answers a tree, not a blob, for a directory of that name: then the fragment leaves it empty.
      if (blob && typeof blob.oid === 'string') {
        found = { path, oid: blob.oid, text: blob.isTruncated ? null : blob.text };
        break;
      }
    }
    result.set(repo, found);
  });
  return result;
}
