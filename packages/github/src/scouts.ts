// Scout reads (DESIGN.md "Scouts"): a repo's PRs by update time, cheap
// metadata first; then the full file list of the few that pass the
// pre-filter, paged to the end; and the top-level folders of a base commit.
// Read-only like every reader call.
import { prKey, type PrKey, type PrRef, type PrState, type ScoutCandidate, type ScoutChangeType, type ScoutFile } from '@postpile/core';
import { graphqlFailure, type GitHubHttp } from './http.ts';
import { actorLogin, isoTime, isoTimeOrNull } from './normalize.ts';
import { batchAlias } from './queries.ts';
import type { RawActor } from './raw.ts';

/** One listing page. 50 keeps a page of bodies light. */
export const SCOUT_LIST_PAGE_SIZE = 50;
/** Files per page, GitHub's maximum. */
export const SCOUT_FILES_PAGE_SIZE = 100;
/** PRs whose first file page goes in one aliased query. */
export const SCOUT_FILES_BATCH_SIZE = 12;
/** A PR lists at most 3,000 files on GitHub: 30 pages. More pages than that is a broken answer. */
export const SCOUT_FILES_MAX_PAGES = 30;

/** One page of a repo's open and merged PRs, newest update first. */
export interface ScoutListPage {
  prs: ScoutCandidate[];
  /** GitHub's cursor for the next page; null on the last one. */
  nextCursor: string | null;
}

/** A PR's whole changed-file list, read at one head. */
export interface ScoutFilesRead {
  headOid: string;
  baseOid: string;
  /**
   * The commit whose root folders were there before the PR: its base while
   * open, the merge commit's first parent once merged (by then the base
   * branch may hold the PR's own new folder).
   */
  foldersOid: string;
  /** Null when the list could not be read whole: the head moved while paging, or GitHub stopped answering. Never a partial list. */
  files: ScoutFile[] | null;
}

const LIST_FIELDS = 'id number updatedAt assignees(first: 10) { nodes { login } } state isDraft mergedAt headRefOid baseRefOid title body author { __typename login } repository { nameWithOwner }';

interface RawListedPr {
  id: string;
  number: number;
  updatedAt: string;
  state: PrState;
  isDraft: boolean;
  mergedAt: string | null;
  headRefOid: string;
  baseRefOid: string;
  title: string;
  body: string | null;
  author: RawActor | null;
  assignees: { nodes: ({ login: string } | null)[] } | null;
  repository: { nameWithOwner: string };
}

interface RawListResponse {
  repository: {
    pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RawListedPr | null)[] };
  } | null;
}

interface RawFilesPage {
  headRefOid: string;
  baseRefOid: string;
  mergeCommit?: { parents: { nodes: ({ oid: string } | null)[] } } | null;
  files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ({ path: string; changeType: ScoutChangeType } | null)[] } | null;
}

type RawFilesBatch = Record<string, { pullRequest: RawFilesPage | null } | null>;

type RawNumberBatch = Record<string, { pullRequest: RawListedPr | null } | null>;

type RawTreeBatch = Record<string, { tree: { entries: { name: string; type: string }[] } } | null>;

function ownerAndName(repo: string): [string, string] {
  const [owner = '', name = ''] = repo.split('/');
  return [owner, name];
}

/** GitHub's node as a scout candidate. The key takes GitHub's spelling of the repo. */
export function toScoutCandidate(raw: RawListedPr): ScoutCandidate {
  return {
    key: prKey({ repo: raw.repository.nameWithOwner, number: raw.number }),
    nodeId: raw.id,
    title: raw.title,
    body: raw.body ?? '',
    author: actorLogin(raw.author),
    assignees: (raw.assignees?.nodes ?? []).flatMap((node) => (node ? [node.login] : [])),
    isDraft: raw.isDraft,
    state: raw.state,
    headOid: raw.headRefOid,
    baseOid: raw.baseRefOid,
    updatedAt: isoTime(raw.updatedAt),
    mergedAt: isoTimeOrNull(raw.mergedAt),
  };
}

/** Open and merged PRs (a PR opened and merged between two syncs is still seen), by update time, newest first. */
export function buildScoutListQuery(repo: string, after: string | null): string {
  const [owner, name] = ownerAndName(repo);
  const cursor = after === null ? '' : `, after: ${JSON.stringify(after)}`;
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequests(first: ${SCOUT_LIST_PAGE_SIZE}${cursor}, states: [OPEN, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ${LIST_FIELDS} }
    }
  }
}`;
}

/** The same metadata for PRs known by number: pending judgements, retried whatever the listing shows. */
export function buildScoutNumberQuery(refs: PrRef[]): string {
  const lines = refs.map((ref, index) => {
    const [owner, name] = ownerAndName(ref.repo);
    return `  ${batchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ${LIST_FIELDS} } }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

function filesSelection(after: string | null): string {
  const cursor = after === null ? '' : `, after: ${JSON.stringify(after)}`;
  // The merge commit only on the first page: the folders before the PR are read once.
  const merge = after === null ? ' mergeCommit { parents(first: 1) { nodes { oid } } }' : '';
  return `headRefOid baseRefOid${merge} files(first: ${SCOUT_FILES_PAGE_SIZE}${cursor}) { pageInfo { hasNextPage endCursor } nodes { path changeType } }`;
}

/** The commit before the PR: the merge commit's first parent once merged, else the base. */
function foldersOidOf(page: RawFilesPage): string {
  return page.mergeCommit?.parents.nodes[0]?.oid ?? page.baseRefOid;
}

/** One file page per PR, aliased: the first page (`after` null) or the next one of a longer list. */
export function buildScoutFilesQuery(pages: { ref: PrRef; after: string | null }[]): string {
  const lines = pages.map(({ ref, after }, index) => {
    const [owner, name] = ownerAndName(ref.repo);
    return `  ${batchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ${filesSelection(after)} } }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

/** The root tree of each commit, aliased t0, t1, ... */
export function buildTreeQuery(repo: string, commitOids: string[]): string {
  const [owner, name] = ownerAndName(repo);
  const lines = commitOids.map((oid, index) => `    t${index}: object(oid: ${JSON.stringify(oid)}) { ... on Commit { tree { entries { name type } } } }`);
  return `query {\n  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n${lines.join('\n')}\n  }\n}`;
}

/** The page's files, or null when a node is null: GitHub left one out, so the page is not whole. */
function filesOf(page: RawFilesPage): ScoutFile[] | null {
  const nodes = page.files?.nodes ?? [];
  if (nodes.some((node) => node === null)) {
    return null;
  }
  return nodes.flatMap((node) => (node ? [{ path: node.path, changeType: node.changeType }] : []));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * One page of the listing. Throws when GitHub answers no data, or answers
 * with field errors or a null node: a page missing a PR is no page, or the
 * caller would count its window as covered without that PR. A repo the
 * token cannot see is an error too.
 */
export async function listScoutPrs(http: GitHubHttp, repo: string, after: string | null): Promise<ScoutListPage> {
  const response = await http.graphql<RawListResponse>(buildScoutListQuery(repo, after));
  const connection = response.data?.repository?.pullRequests;
  if (!connection) {
    throw graphqlFailure(`scout listing of ${repo}`, response.errors);
  }
  if (response.errors.length > 0 || connection.nodes.some((node) => node === null)) {
    throw graphqlFailure(`scout listing of ${repo} (incomplete page)`, response.errors);
  }
  const prs = connection.nodes.flatMap((node) => (node ? [toScoutCandidate(node)] : []));
  return { prs, nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null };
}

/**
 * Metadata per PR known by number; one GitHub no longer has or the token
 * cannot see is left out. A failed query costs only its own batch: those
 * PRs are left out too (their pending rows wait for the next run), the
 * other batches' answers stand.
 */
export async function scoutPrsByNumber(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutCandidate>> {
  const result = new Map<PrKey, ScoutCandidate>();
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    let response;
    try {
      response = await http.graphql<RawNumberBatch>(buildScoutNumberQuery(batch));
    } catch {
      continue;
    }
    if (!response.data) {
      continue;
    }
    batch.forEach((ref, index) => {
      const raw = response.data?.[batchAlias(index)]?.pullRequest;
      if (raw) {
        // Keyed as asked, so the caller finds its pending row whatever spelling GitHub answers with.
        result.set(prKey(ref), { ...toScoutCandidate(raw), key: prKey(ref) });
      }
    });
  }
  return result;
}

/**
 * One PR's node id, for Follow. Null only when GitHub answers that it has
 * no such PR the token can see (NOT_FOUND). A failed request, bad auth or a
 * rate limit throws, so Follow can say what went wrong instead of "no such
 * PR".
 */
export async function scoutPrNodeId(http: GitHubHttp, ref: PrRef): Promise<string | null> {
  const [owner, name] = ownerAndName(ref.repo);
  const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { id } } }`;
  const response = await http.graphql<{ repository: { pullRequest: { id: string } | null } | null }>(query);
  const id = response.data?.repository?.pullRequest?.id ?? null;
  if (id !== null) {
    return id;
  }
  if (response.errors.length > 0 && response.errors.every((error) => error.type === 'NOT_FOUND')) {
    return null;
  }
  if (response.errors.length > 0 || !response.data) {
    throw graphqlFailure(`lookup of ${prKey(ref)}`, response.errors);
  }
  return null;
}

/** One PR's file list while it is being paged. */
interface FilesProgress {
  ref: PrRef;
  headOid: string;
  baseOid: string;
  foldersOid: string;
  files: ScoutFile[];
  /** GitHub's cursor for the next page; null once the list is whole. */
  after: string | null;
  pages: number;
  /** The head or base moved while paging, a page failed, or the list ran past SCOUT_FILES_MAX_PAGES. */
  broken: boolean;
}

/** The next page of each PR in the batch, in one aliased query. Every page must answer at the head the first one saw. */
async function nextFilePages(http: GitHubHttp, batch: FilesProgress[]): Promise<void> {
  let response;
  try {
    response = await http.graphql<RawFilesBatch>(buildScoutFilesQuery(batch.map((entry) => ({ ref: entry.ref, after: entry.after }))));
  } catch {
    batch.forEach((entry) => (entry.broken = true));
    return;
  }
  // Field errors may have nulled any part of the answer: none of its pages counts as whole.
  const errored = response.errors.length > 0;
  batch.forEach((entry, index) => {
    const page = response.data?.[batchAlias(index)]?.pullRequest;
    const files = page ? filesOf(page) : null;
    if (errored || !page?.files || files === null || page.headRefOid !== entry.headOid || page.baseRefOid !== entry.baseOid) {
      entry.broken = true;
      return;
    }
    entry.files.push(...files);
    entry.pages += 1;
    entry.after = page.files.pageInfo.hasNextPage ? page.files.pageInfo.endCursor : null;
    entry.broken = entry.after !== null && entry.pages >= SCOUT_FILES_MAX_PAGES;
  });
}

/**
 * The whole file list per PR: the first pages aliased, then the next pages
 * of every longer list together, SCOUT_FILES_BATCH_SIZE PRs per query,
 * until each is whole. A moved head (a push while paging) or a failed page
 * makes that PR's list unknown, never a shorter one: a signal on page two
 * must not read as "no signal". A failed query costs only its own batch:
 * those PRs come back with no list. A PR GitHub does not answer for is
 * left out.
 */
export async function scoutFiles(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutFilesRead>> {
  const progress: FilesProgress[] = [];
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    let response;
    try {
      response = await http.graphql<RawFilesBatch>(buildScoutFilesQuery(batch.map((ref) => ({ ref, after: null }))));
    } catch {
      response = { data: null, errors: [] };
    }
    if (!response.data) {
      // This batch only: its PRs come back without a list (pending for the caller); the other batches' reads stand.
      batch.forEach((ref) => progress.push({ ref, headOid: '', baseOid: '', foldersOid: '', files: [], after: null, pages: 1, broken: true }));
      continue;
    }
    const errored = response.errors.length > 0;
    batch.forEach((ref, index) => {
      const first = response.data?.[batchAlias(index)]?.pullRequest;
      if (!first) {
        return;
      }
      const files = filesOf(first);
      const after = first.files?.pageInfo.hasNextPage ? first.files.pageInfo.endCursor : null;
      // Field errors or a null node: the list is not whole, whatever the rest of the page says.
      const broken = errored || first.files === null || files === null;
      progress.push({ ref, headOid: first.headRefOid, baseOid: first.baseRefOid, foldersOid: foldersOidOf(first), files: files ?? [], after, pages: 1, broken });
    });
  }
  let open = progress.filter((entry) => !entry.broken && entry.after !== null);
  while (open.length > 0) {
    for (const batch of chunk(open, SCOUT_FILES_BATCH_SIZE)) {
      await nextFilePages(http, batch);
    }
    open = open.filter((entry) => !entry.broken && entry.after !== null);
  }
  return new Map(progress.map((entry) => [prKey(entry.ref), { headOid: entry.headOid, baseOid: entry.baseOid, foldersOid: entry.foldersOid, files: entry.broken ? null : entry.files }]));
}

/**
 * Directory names at the root of each commit's tree. A commit GitHub does
 * not answer for is left out, and so is a failed batch: the other batches'
 * reads stand, like file lists and number lookups.
 */
export async function topLevelFolders(http: GitHubHttp, repo: string, commitOids: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const batch of chunk(commitOids, SCOUT_FILES_BATCH_SIZE)) {
    let response;
    try {
      response = await http.graphql<{ repository: RawTreeBatch | null }>(buildTreeQuery(repo, batch));
    } catch {
      continue;
    }
    if (!response.data) {
      continue;
    }
    batch.forEach((oid, index) => {
      const tree = response.data?.repository?.[`t${index}`]?.tree;
      if (tree) {
        result.set(
          oid,
          tree.entries.filter((entry) => entry.type === 'tree').map((entry) => entry.name),
        );
      }
    });
  }
  return result;
}
