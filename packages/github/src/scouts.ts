// Scout reads (DESIGN.md "Scouts"): a repo's PRs by update time, cheap
// metadata first; then the full file list of the few that pass the
// pre-filter, paged to the end; and the top-level folders of a base commit.
// Read-only like every reader call.
import { prKey, type PrKey, type PrRef, type PrState, type ScoutCandidate, type ScoutChangeType, type ScoutFile } from '@postpile/core';
import { GitHubError, graphqlFailure, type GitHubHttp, type GraphQLResult } from './http.ts';
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

const LIST_FIELDS = 'number updatedAt assignees(first: 10) { nodes { login } } state isDraft mergedAt headRefOid baseRefOid title body author { __typename login } repository { nameWithOwner }';

interface RawListedPr {
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
  files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ({ path: string; changeType: ScoutChangeType; additions: number; deletions: number } | null)[] } | null;
}

type RawFilesBatch = Record<string, { pullRequest: RawFilesPage | null } | null>;

type RawNumberBatch = Record<string, { pullRequest: RawListedPr | null } | null>;

/** `{}` for an object that is no tree (a file or symlink at that path): the Tree-only fragment selects nothing. */
type RawTreeBatch = Record<string, { entries?: { name: string; type: string }[] } | null>;

function ownerAndName(repo: string): [string, string] {
  const [owner = '', name = ''] = repo.split('/');
  return [owner, name];
}

/** GitHub's node as a scout candidate. The key takes GitHub's spelling of the repo. */
export function toScoutCandidate(raw: RawListedPr): ScoutCandidate {
  return {
    key: prKey({ repo: raw.repository.nameWithOwner, number: raw.number }),
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
  return `headRefOid baseRefOid${merge} files(first: ${SCOUT_FILES_PAGE_SIZE}${cursor}) { pageInfo { hasNextPage endCursor } nodes { path changeType additions deletions } }`;
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

/** One folder of one commit whose subfolders a scout needs: "" for the repo root. */
export interface ScoutFolderRead {
  oid: string;
  parent: string;
}

/** The key `scoutFolders` answers under: "<oid>:<parent>". */
export function scoutFolderKey(read: ScoutFolderRead): string {
  return `${read.oid}:${read.parent}`;
}

/** Each folder's tree at its commit (`<oid>:<parent>`, "<oid>:" for the root), aliased t0, t1, ... */
export function buildTreeQuery(repo: string, reads: ScoutFolderRead[]): string {
  const [owner, name] = ownerAndName(repo);
  const lines = reads.map((read, index) => `    t${index}: object(expression: ${JSON.stringify(scoutFolderKey(read))}) { ... on Tree { entries { name type } } }`);
  return `query {\n  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n${lines.join('\n')}\n  }\n}`;
}

/** The page's files, or null when a node is null: GitHub left one out, so the page is not whole. */
function filesOf(page: RawFilesPage): ScoutFile[] | null {
  const nodes = page.files?.nodes ?? [];
  if (nodes.some((node) => node === null)) {
    return null;
  }
  return nodes.flatMap((node) => (node ? [{ path: node.path, changeType: node.changeType, additions: node.additions, deletions: node.deletions }] : []));
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
 * GitHub asked scout reads to slow down (a secondary limit, 429, or a
 * GraphQL RATE_LIMITED): the read stopped there, and the caller stops every
 * scout read for the rest of the run. `partial` holds what the read had
 * finished before, in the shape it would have returned.
 */
export class ScoutReadsLimited<T> extends GitHubError {
  constructor(
    cause: GitHubError,
    readonly partial: T,
  ) {
    super(cause.message, cause.status, { rateLimited: true, retryAfterSeconds: cause.retryAfterSeconds });
    this.name = 'ScoutReadsLimited';
  }
}

function isRateLimit(error: unknown): error is GitHubError {
  return error instanceof GitHubError && error.rateLimited;
}

/**
 * One batch query of a scout read. A rate limit throws, so the read stops;
 * any other failure answers null and costs only this batch.
 */
async function scoutBatch<T>(http: GitHubHttp, query: string): Promise<GraphQLResult<T> | null> {
  let response;
  try {
    response = await http.graphql<T>(query);
  } catch (error) {
    if (isRateLimit(error)) {
      throw error;
    }
    return null;
  }
  const limited = response.errors.find((error) => error.type === 'RATE_LIMITED');
  if (limited) {
    throw new GitHubError(`GitHub scout read failed: ${limited.message}`, 200, { rateLimited: true, retryAfterSeconds: null });
  }
  return response;
}

/**
 * Metadata per PR known by number; one GitHub no longer has or the token
 * cannot see is left out. A failed query costs only its own batch: those
 * PRs are left out too (their pending rows wait for the next run), the
 * other batches' answers stand. A rate limit stops it (`ScoutReadsLimited`).
 */
export async function scoutPrsByNumber(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutCandidate>> {
  const result = new Map<PrKey, ScoutCandidate>();
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    let response;
    try {
      response = await scoutBatch<RawNumberBatch>(http, buildScoutNumberQuery(batch));
    } catch (error) {
      throw new ScoutReadsLimited(error as GitHubError, result);
    }
    if (!response?.data) {
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
  const response = await scoutBatch<RawFilesBatch>(http, buildScoutFilesQuery(batch.map((entry) => ({ ref: entry.ref, after: entry.after }))));
  if (response === null) {
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

function filesReads(progress: FilesProgress[]): Map<PrKey, ScoutFilesRead> {
  return new Map(progress.map((entry) => [prKey(entry.ref), { headOid: entry.headOid, baseOid: entry.baseOid, foldersOid: entry.foldersOid, files: entry.broken ? null : entry.files }]));
}

/** The first pages, then the next pages of every longer list, into `progress`. */
async function readFilePages(http: GitHubHttp, refs: PrRef[], progress: FilesProgress[]): Promise<void> {
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    const response = await scoutBatch<RawFilesBatch>(http, buildScoutFilesQuery(batch.map((ref) => ({ ref, after: null }))));
    if (!response?.data) {
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
}

/**
 * The whole file list per PR: the first pages aliased, then the next pages
 * of every longer list together, SCOUT_FILES_BATCH_SIZE PRs per query,
 * until each is whole. A moved head (a push while paging) or a failed page
 * makes that PR's list unknown, never a shorter one: a signal on page two
 * must not read as "no signal". A failed query costs only its own batch:
 * those PRs come back with no list. A PR GitHub does not answer for is
 * left out. A rate limit stops it (`ScoutReadsLimited`, with the lists
 * finished by then).
 */
export async function scoutFiles(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutFilesRead>> {
  const progress: FilesProgress[] = [];
  try {
    await readFilePages(http, refs, progress);
  } catch (error) {
    if (!isRateLimit(error)) {
      throw error;
    }
    // Lists still paging when GitHub said stop are not whole.
    progress.filter((entry) => entry.after !== null).forEach((entry) => (entry.broken = true));
    throw new ScoutReadsLimited(error, filesReads(progress));
  }
  return filesReads(progress);
}

/**
 * The folders inside each asked folder at its commit, as repo paths
 * ("src", "products/billing"), keyed by `scoutFolderKey`. A folder the
 * commit does not have answers no folders: everything in it is new. A
 * failed batch is left out, the other batches' reads stand, like file
 * lists and number lookups. A rate limit stops it (`ScoutReadsLimited`).
 */
export async function scoutFolders(http: GitHubHttp, repo: string, reads: ScoutFolderRead[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const batch of chunk(reads, SCOUT_FILES_BATCH_SIZE)) {
    let response;
    try {
      response = await scoutBatch<{ repository: RawTreeBatch | null }>(http, buildTreeQuery(repo, batch));
    } catch (error) {
      throw new ScoutReadsLimited(error as GitHubError, result);
    }
    if (!response?.data?.repository || response.errors.length > 0) {
      continue;
    }
    batch.forEach((read, index) => {
      // Missing, or a file or symlink where the folder would be: no folders there, so everything in it is new.
      const entries = response.data?.repository?.[`t${index}`]?.entries ?? [];
      const names = entries.filter((entry) => entry.type === 'tree').map((entry) => entry.name);
      result.set(scoutFolderKey(read), names.map((entry) => (read.parent === '' ? entry : `${read.parent}/${entry}`)));
    });
  }
  return result;
}
