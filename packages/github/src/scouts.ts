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
  /** Null when the list could not be read whole: the head moved while paging, or GitHub stopped answering. Never a partial list. */
  files: ScoutFile[] | null;
}

const LIST_FIELDS = 'number updatedAt state isDraft mergedAt headRefOid baseRefOid title body author { __typename login } repository { nameWithOwner }';

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
    title: raw.title,
    body: raw.body ?? '',
    author: actorLogin(raw.author),
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
  return `headRefOid baseRefOid files(first: ${SCOUT_FILES_PAGE_SIZE}${cursor}) { pageInfo { hasNextPage endCursor } nodes { path changeType } }`;
}

/** The first file page of each PR, aliased. */
export function buildScoutFilesQuery(refs: PrRef[]): string {
  const lines = refs.map((ref, index) => {
    const [owner, name] = ownerAndName(ref.repo);
    return `  ${batchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ${filesSelection(null)} } }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

/** A later file page of one PR. */
export function buildScoutFilesPageQuery(ref: PrRef, after: string): string {
  const [owner, name] = ownerAndName(ref.repo);
  return `query {\n  ${batchAlias(0)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ${filesSelection(after)} } }\n}`;
}

/** The root tree of each commit, aliased t0, t1, ... */
export function buildTreeQuery(repo: string, commitOids: string[]): string {
  const [owner, name] = ownerAndName(repo);
  const lines = commitOids.map((oid, index) => `    t${index}: object(oid: ${JSON.stringify(oid)}) { ... on Commit { tree { entries { name type } } } }`);
  return `query {\n  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n${lines.join('\n')}\n  }\n}`;
}

function filesOf(page: RawFilesPage): ScoutFile[] {
  return (page.files?.nodes ?? []).flatMap((node) => (node ? [{ path: node.path, changeType: node.changeType }] : []));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** One page of the listing. Throws when GitHub answers no data; a repo the token cannot see is an error too. */
export async function listScoutPrs(http: GitHubHttp, repo: string, after: string | null): Promise<ScoutListPage> {
  const response = await http.graphql<RawListResponse>(buildScoutListQuery(repo, after));
  const connection = response.data?.repository?.pullRequests;
  if (!connection) {
    throw graphqlFailure(`scout listing of ${repo}`, response.errors);
  }
  const prs = connection.nodes.flatMap((node) => (node ? [toScoutCandidate(node)] : []));
  return { prs, nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null };
}

/** Metadata per PR known by number; one GitHub no longer has or the token cannot see is left out. */
export async function scoutPrsByNumber(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutCandidate>> {
  const result = new Map<PrKey, ScoutCandidate>();
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    const response = await http.graphql<RawNumberBatch>(buildScoutNumberQuery(batch));
    if (!response.data) {
      throw graphqlFailure('scout PR lookup', response.errors);
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
 * Pages one PR's files to the end. Every page must answer at the head the
 * first page saw; a moved head (a push while paging) or a failed page makes
 * the list unknown, never a shorter one: a signal on page two must not read
 * as "no signal".
 */
async function remainingFiles(http: GitHubHttp, ref: PrRef, first: RawFilesPage): Promise<ScoutFile[] | null> {
  const files = filesOf(first);
  let after = first.files?.pageInfo.hasNextPage ? first.files.pageInfo.endCursor : null;
  let pages = 1;
  while (after !== null) {
    if (pages >= SCOUT_FILES_MAX_PAGES) {
      return null;
    }
    const response = await http.graphql<RawFilesBatch>(buildScoutFilesPageQuery(ref, after));
    const page = response.data?.[batchAlias(0)]?.pullRequest;
    if (!page?.files || page.headRefOid !== first.headRefOid || page.baseRefOid !== first.baseRefOid) {
      return null;
    }
    files.push(...filesOf(page));
    pages += 1;
    after = page.files.pageInfo.hasNextPage ? page.files.pageInfo.endCursor : null;
  }
  return files;
}

/** The whole file list per PR. A PR GitHub does not answer for is left out. */
export async function scoutFiles(http: GitHubHttp, refs: PrRef[]): Promise<Map<PrKey, ScoutFilesRead>> {
  const result = new Map<PrKey, ScoutFilesRead>();
  for (const batch of chunk(refs, SCOUT_FILES_BATCH_SIZE)) {
    const response = await http.graphql<RawFilesBatch>(buildScoutFilesQuery(batch));
    if (!response.data) {
      throw graphqlFailure('scout files query', response.errors);
    }
    for (const [index, ref] of batch.entries()) {
      const first = response.data[batchAlias(index)]?.pullRequest;
      if (!first) {
        continue;
      }
      const files = first.files ? await remainingFiles(http, ref, first).catch(() => null) : null;
      result.set(prKey(ref), { headOid: first.headRefOid, baseOid: first.baseRefOid, files });
    }
  }
  return result;
}

/** Directory names at the root of each commit's tree. A commit GitHub does not answer for is left out. */
export async function topLevelFolders(http: GitHubHttp, repo: string, commitOids: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const batch of chunk(commitOids, SCOUT_FILES_BATCH_SIZE)) {
    const response = await http.graphql<{ repository: RawTreeBatch | null }>(buildTreeQuery(repo, batch));
    if (!response.data) {
      throw graphqlFailure('scout tree query', response.errors);
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
