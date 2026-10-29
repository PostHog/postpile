import type { AgentService, ScoutJudgeItem } from '@postpile/agent';
import {
  isScoutedActive,
  parsePrKey,
  scoutBodyHead,
  scoutedExpiry,
  scoutInputHash,
  scoutJudgeStep,
  scoutListingFloor,
  scoutPrefilter,
  scoutPullStep,
  scoutRetentionCutoff,
  scoutSignals,
  SCOUT_TRIAL_EXAMPLES,
  type IsoTime,
  type ScoutTrial,
  type PrKey,
  type PrRef,
  type ScoutCandidate,
  type ScoutConfig,
  type ScoutedPr,
  type ScoutFile,
  type ScoutJudgement,
  type ScoutPrefilterReason,
  type ScoutsVersion,
  type Viewer,
} from '@postpile/core';
import type { GitHubReader, ScoutFilesRead } from '@postpile/github';
import type { Store } from '@postpile/store';
import type { AgentBudget } from '../budget.ts';
import { errorText } from '../errors.ts';
import { threadsByPrKey } from '../hot-set.ts';
import { chunk } from '../lists.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import type { ScoutsHistory } from './history.ts';

/**
 * Listing pages per repo and run: 500 PRs. A busier window leaves the
 * cursor where it was, and the next run goes on below where this one
 * stopped (`ListingResume`) after the updates since.
 */
export const SCOUT_LIST_MAX_PAGES = 10;
/** PRs per scout_judge call. */
export const SCOUT_JUDGE_BATCH = 12;

const PREFILTER_WORDS: Record<ScoutPrefilterReason, string> = {
  draft: 'a draft',
  dependency_bot: 'a dependency or merge-queue bot opened it',
  you: 'your own PR',
  your_team: "a teammate's PR",
  tracked: 'already in your inbox',
};

export interface ScoutRunDeps {
  store: Store;
  reader: GitHubReader;
  agent: AgentService;
  contexts: PromptContextSource;
  history: ScoutsHistory;
  /** Fetches PRs in full and stores them with their events, untracked (`GitHubSync.fetchAndStoreScouted`). */
  storePrs: (refs: PrRef[], errors: string[]) => Promise<PrKey[]>;
  now: () => Date;
  log: (line: string) => void;
}

/** What one full sync hands the scouts. */
export interface ScoutRunInput {
  viewer: Viewer;
  budget: AgentBudget;
  errors: string[];
  /** The claude headline while the agent is off, else null: judgements then stay pending. */
  agentOff: string | null;
  /** Background GitHub reads are allowed now (the quota is not low). Asked before each read, since the scouts' own reads lower it. */
  quotaAllows: () => boolean;
  /** Glances the active scouted PRs that need one (`GlanceBatchWriter.runScouted`). */
  glance: () => Promise<void>;
}

export interface ScoutRunReport {
  listed: number;
  judged: number;
  pulled: number;
  pending: number;
  expired: number;
}

/** One repo's listing for this run, shared by every scout on it. */
interface RepoListing {
  prs: Map<PrKey, ScoutCandidate>;
  /** Down to the oldest floor of the scouts on the repo, without a cap, error or partial answer. */
  complete: boolean;
}

/**
 * Where a capped listing stopped, kept in meta per repo: GitHub's cursor
 * after the last page read, and when the run that started the pass began.
 * The next run lists the updates since that start, then goes on below the
 * cursor down to the floor, instead of reading the same top pages again.
 */
interface ListingResume {
  after: string;
  startedAt: IsoTime;
}

/** How one paging pass ended: down to its floor, at the page budget, or on a failed read. */
type PassEnd = { kind: 'done' } | { kind: 'capped'; after: string } | { kind: 'failed' };

function resumeKey(repo: string): string {
  return `scout_listing_resume:${repo.toLowerCase()}`;
}

/** One scout's work on one repo in this run, written in one transaction with the cursor. */
interface ScoutRepoWork {
  rows: ScoutJudgement[];
  pulls: ScoutedPr[];
}

/** A candidate read whole and ready to ask the model about. */
interface JudgeItem {
  candidate: ScoutCandidate;
  item: ScoutJudgeItem;
  inputHash: string;
  existing: ScoutJudgement | null;
}

function repoOf(key: PrKey): string {
  return parsePrKey(key).repo.toLowerCase();
}

function refOf(key: PrKey): PrRef {
  return parsePrKey(key);
}

/**
 * The scout step of a full sync (DESIGN.md "Scouts"), after the inbox
 * work: list each scout repo's recently updated PRs once, cut them by
 * rules, read the files of new or moved candidates, ask the model per
 * scout, store the pulled ones untracked and glance them, refresh and
 * expire what is on the Scouted section, and drop old skipped judgements.
 *
 * The cursor is completed coverage: it moves to this run's start only
 * once the scout's whole window was listed and every candidate stored as
 * judged or pending, in the same transaction. Pending work is retried
 * every run whatever the cursor says.
 */
export class ScoutRun {
  /** Root folders per "repo@commit", kept across runs: a commit's tree never changes. */
  private readonly trees = new Map<string, string[]>();
  /** Whole file lists read in this run, by "PR@head": scouts on the same repo share them. Cleared at each run's start. */
  private runFiles = new Map<string, ScoutFilesRead>();
  /** The running sync's quota check; reads stop once it says no and the rest stays pending. */
  private quotaAllows: () => boolean = () => true;

  constructor(private readonly deps: ScoutRunDeps) {}

  private judgementRow(scoutId: string, version: ScoutsVersion | null, candidate: ScoutCandidate, existing: ScoutJudgement | null): ScoutJudgement {
    return {
      scoutId,
      prKey: candidate.key,
      status: 'pending',
      verdict: null,
      reason: null,
      inputHash: null,
      configVersion: version?.version ?? 0,
      headOid: candidate.headOid,
      observedUpdatedAt: candidate.updatedAt,
      attempts: existing?.attempts ?? 0,
      lastError: null,
      judgedAt: null,
    };
  }

  private pending(base: ScoutJudgement, why: string, inputHash: string | null = null, attempted = false): ScoutJudgement {
    return { ...base, inputHash, lastError: why, attempts: base.attempts + (attempted ? 1 : 0) };
  }

  private judged(base: ScoutJudgement, verdict: 'pulled' | 'skipped', reason: string, inputHash: string | null, attempted: boolean): ScoutJudgement {
    const at = this.deps.now().toISOString();
    return { ...base, status: 'judged', verdict, reason, inputHash, lastError: null, judgedAt: at, attempts: base.attempts + (attempted ? 1 : 0) };
  }

  /**
   * One paging pass, newest first from `after` down to `floor` (inclusive),
   * adding what it lists to `prs`. Stops at the page budget it shares with
   * the run's other pass on the repo, on a failed read, or when the quota
   * says no.
   */
  private async pass(repo: string, after: string | null, floor: IsoTime, budget: { pages: number }, prs: Map<PrKey, ScoutCandidate>, errors: string[]): Promise<PassEnd> {
    let cursor = after;
    while (budget.pages > 0) {
      if (!this.quotaAllows()) {
        this.deps.log(`scouts: GitHub quota low, stopped listing ${repo}`);
        return { kind: 'failed' };
      }
      budget.pages -= 1;
      let result;
      try {
        result = await this.deps.reader.listScoutPrs(repo, cursor);
      } catch (error) {
        errors.push(`scouts: listing ${repo}: ${errorText(error)}`);
        return { kind: 'failed' };
      }
      let reachedFloor = false;
      for (const pr of result.prs) {
        if (pr.updatedAt < floor) {
          reachedFloor = true;
          break;
        }
        prs.set(pr.key, pr);
      }
      if (reachedFloor || result.nextCursor === null) {
        return { kind: 'done' };
      }
      cursor = result.nextCursor;
    }
    return cursor === null ? { kind: 'done' } : { kind: 'capped', after: cursor };
  }

  private readResume(repo: string): ListingResume | null {
    const raw = this.deps.store.meta.get(resumeKey(repo));
    return raw === null ? null : (JSON.parse(raw) as ListingResume);
  }

  /** After the pass that reaches the floor: done clears the resume point, a cap moves it, a failed read keeps it. */
  private settle(repo: string, end: PassEnd, startedAt: IsoTime): boolean {
    if (end.kind === 'done') {
      this.deps.store.meta.delete(resumeKey(repo));
      return true;
    }
    if (end.kind === 'capped') {
      this.deps.store.meta.set(resumeKey(repo), JSON.stringify({ after: end.after, startedAt } satisfies ListingResume));
      this.deps.log(`scouts: ${repo} has more than ${SCOUT_LIST_MAX_PAGES} pages of updates to list; the next sync goes on where this one stopped`);
    }
    return false;
  }

  /**
   * The repo's listing down to `floor`, in at most SCOUT_LIST_MAX_PAGES
   * pages. After a capped run it first lists the updates since that run
   * started (PRs updated since moved to the top), then goes on below where
   * it stopped. Complete only once a pass reached the floor.
   */
  private async list(repo: string, floor: IsoTime, runStart: IsoTime, errors: string[]): Promise<RepoListing> {
    const prs = new Map<PrKey, ScoutCandidate>();
    const budget = { pages: SCOUT_LIST_MAX_PAGES };
    const resume = this.readResume(repo);
    if (resume === null) {
      const end = await this.pass(repo, null, floor, budget, prs, errors);
      return { prs, complete: this.settle(repo, end, runStart) };
    }
    const sinceStop = scoutListingFloor(resume.startedAt, runStart);
    const top = await this.pass(repo, null, sinceStop > floor ? sinceStop : floor, budget, prs, errors);
    if (top.kind !== 'done') {
      return { prs, complete: false };
    }
    const lower = await this.pass(repo, resume.after, floor, budget, prs, errors);
    return { prs, complete: this.settle(repo, lower, resume.startedAt) };
  }

  /** Root folders of the bases that need them, from the cache or one read. A failed read leaves them unknown. */
  private async baseFolders(repo: string, oids: string[]): Promise<void> {
    const wanted = [...new Set(oids)].filter((oid) => !this.trees.has(`${repo}@${oid}`));
    if (wanted.length === 0 || !this.quotaAllows()) {
      return;
    }
    try {
      for (const [oid, folders] of await this.deps.reader.topLevelFolders(repo, wanted)) {
        this.trees.set(`${repo}@${oid}`, folders);
      }
    } catch (error) {
      this.deps.log(`scouts: base tree of ${repo}: ${errorText(error)}`);
    }
  }

  /**
   * Whole file lists, from this run's reads when another scout on the repo
   * read the same head already. A failed read, or a quota that says no,
   * leaves them unknown, so their candidates stay pending.
   */
  private async files(candidates: ScoutCandidate[]): Promise<Map<PrKey, ScoutFilesRead>> {
    const result = new Map<PrKey, ScoutFilesRead>();
    const unread: ScoutCandidate[] = [];
    for (const candidate of candidates) {
      const read = this.runFiles.get(`${candidate.key}@${candidate.headOid}`);
      if (read) {
        result.set(candidate.key, read);
      } else {
        unread.push(candidate);
      }
    }
    if (unread.length === 0 || !this.quotaAllows()) {
      return result;
    }
    try {
      for (const [key, read] of await this.deps.reader.scoutFiles(unread.map((candidate) => refOf(candidate.key)))) {
        result.set(key, read);
        if (read.files !== null) {
          this.runFiles.set(`${key}@${read.headOid}`, read);
        }
      }
    } catch (error) {
      this.deps.log(`scouts: file lists: ${errorText(error)}`);
    }
    return result;
  }

  /** The scout's candidates on this repo: the listed ones in its own window, plus its pending ones whatever the cursor says. */
  private async candidatesFor(scout: ScoutConfig, repo: string, listing: RepoListing, floor: IsoTime): Promise<ScoutCandidate[]> {
    const candidates = new Map<PrKey, ScoutCandidate>();
    for (const pr of listing.prs.values()) {
      if (pr.updatedAt >= floor) {
        candidates.set(pr.key, pr);
      }
    }
    const pendingKeys = this.deps.store.scoutJudgements
      .listPending(scout.id)
      .map((row) => row.prKey)
      .filter((key) => repoOf(key) === repo.toLowerCase() && !candidates.has(key));
    const byKey = new Map([...listing.prs.values()].map((pr) => [pr.key, pr]));
    const lookUp = pendingKeys.filter((key) => !byKey.has(key));
    if (lookUp.length > 0) {
      try {
        for (const [key, pr] of await this.deps.reader.scoutPrsByNumber(lookUp.map(refOf))) {
          byKey.set(key, pr);
        }
      } catch (error) {
        this.deps.log(`scouts: pending PRs of ${scout.id}: ${errorText(error)}`);
      }
    }
    for (const key of pendingKeys) {
      const pr = byKey.get(key);
      if (pr) {
        candidates.set(key, pr);
      }
    }
    return [...candidates.values()];
  }

  /**
   * One scout on one repo up to the model call: rules, files, signals and
   * the re-judge decision. Rows that need no model call are in `work`;
   * the rest come back to be judged.
   */
  private async prepare(
    scout: ScoutConfig,
    version: ScoutsVersion | null,
    repo: string,
    candidates: ScoutCandidate[],
    facts: { viewer: Viewer; tracked: ReadonlySet<PrKey> },
    work: ScoutRepoWork,
  ): Promise<JudgeItem[]> {
    const { store } = this.deps;
    const existing = store.scoutJudgements.getMany(scout.id, candidates.map((candidate) => candidate.key));
    const scouted = store.scoutedPrs.getMany(candidates.map((candidate) => candidate.key));
    const needFiles: ScoutCandidate[] = [];
    for (const candidate of candidates) {
      const before = existing.get(candidate.key) ?? null;
      const base = this.judgementRow(scout.id, version, candidate, before);
      const left = scoutPrefilter(candidate, facts);
      if (left !== null) {
        // Only a pending row needs closing; a PR never judged leaves no trace.
        if (before?.status === 'pending') {
          work.rows.push(this.judged(base, 'skipped', `left out: ${PREFILTER_WORDS[left]}`, null, false));
        }
        continue;
      }
      if (scouted.get(candidate.key)?.scoutId === scout.id) {
        continue;
      }
      // Same head and scouts.md as last judged: the files are the same. A title or description edit alone is not read
      // again; an edited scouts.md reads the files once more, and the hash then says whether this scout changed.
      if (before?.status === 'judged' && before.headOid === candidate.headOid && before.configVersion === (version?.version ?? 0)) {
        work.rows.push({ ...before, observedUpdatedAt: candidate.updatedAt });
        continue;
      }
      needFiles.push(candidate);
    }
    const files = await this.files(needFiles);
    const wantsTree = scout.paths.some((hint) => hint.newTopLevelFolder);
    if (wantsTree) {
      await this.baseFolders(repo, [...files.values()].filter((read) => read.files !== null).map((read) => read.baseOid));
    }
    const toJudge: JudgeItem[] = [];
    for (const candidate of needFiles) {
      const before = existing.get(candidate.key) ?? null;
      const base = this.judgementRow(scout.id, version, candidate, before);
      const read = files.get(candidate.key);
      if (!read || read.files === null || read.headOid !== candidate.headOid) {
        work.rows.push(this.pending(base, 'file list not read whole'));
        continue;
      }
      const folders = this.trees.get(`${repo}@${read.baseOid}`);
      if (wantsTree && folders === undefined) {
        work.rows.push(this.pending(base, 'base tree not read'));
        continue;
      }
      const signals = scoutSignals(scout, read.files, new Set(folders ?? []));
      const inputHash = scoutInputHash(scout, candidate, read.files, signals);
      const step = scoutJudgeStep({ existing: before, pulledByThisScout: false, inputHash, hasPathHints: scout.paths.length > 0, signals: signals.length });
      if (step === 'unchanged') {
        work.rows.push({ ...before!, headOid: candidate.headOid, observedUpdatedAt: candidate.updatedAt, configVersion: version?.version ?? 0 });
      } else if (step === 'no_signal') {
        work.rows.push(this.judged(base, 'skipped', 'no path signal', inputHash, false));
      } else {
        toJudge.push({ candidate, inputHash, existing: before, item: this.judgeItem(candidate, read.files, signals, folders ?? []) });
      }
    }
    return toJudge;
  }

  private judgeItem(candidate: ScoutCandidate, files: ScoutFile[], signals: ReturnType<typeof scoutSignals>, folders: string[]): ScoutJudgeItem {
    return {
      prKey: candidate.key,
      title: candidate.title,
      bodyHead: scoutBodyHead(candidate.body),
      author: candidate.author,
      state: candidate.state,
      files,
      signals,
      baseFolders: folders,
    };
  }

  /** The model calls for one scout's items on one repo, in batches. Calls the cap refuses, failures and left-out PRs stay pending. */
  private async judge(scout: ScoutConfig, version: ScoutsVersion | null, items: JudgeItem[], input: ScoutRunInput, work: ScoutRepoWork): Promise<void> {
    const { agent, contexts, store } = this.deps;
    for (const batch of chunk(items, SCOUT_JUDGE_BATCH)) {
      const bases = new Map(batch.map((entry) => [entry.candidate.key, this.judgementRow(scout.id, version, entry.candidate, entry.existing)]));
      const pendAll = (why: string, attempted: boolean) => batch.forEach((entry) => work.rows.push(this.pending(bases.get(entry.candidate.key)!, why, entry.inputHash, attempted)));
      if (input.agentOff !== null) {
        pendAll('agent is off', false);
        continue;
      }
      if (!input.budget.take('scout_judge')) {
        pendAll('stopped at the agent-call cap', false);
        continue;
      }
      let result;
      try {
        result = await agent.judgeScouts({ scout: { name: scout.name, prompt: scout.prompt }, items: batch.map((entry) => entry.item), viewer: input.viewer, context: contexts.forTopic(null) });
      } catch (error) {
        pendAll(`judge call failed: ${errorText(error)}`, true);
        continue;
      }
      const answers = new Map(result.answers.map((answer) => [answer.prKey, answer]));
      for (const entry of batch) {
        const base = bases.get(entry.candidate.key)!;
        const answer = answers.get(entry.candidate.key);
        if (!answer) {
          work.rows.push(this.pending(base, 'left out of the answer', entry.inputHash, true));
          continue;
        }
        if (answer.verdict === 'skip') {
          work.rows.push(this.judged(base, 'skipped', answer.reason, entry.inputHash, true));
          continue;
        }
        work.rows.push(this.judged(base, 'pulled', answer.reason, entry.inputHash, true));
        const owner = store.scoutedPrs.get(entry.candidate.key) ?? work.pulls.find((pull) => pull.prKey === entry.candidate.key) ?? null;
        if (scoutPullStep(owner, scout.id) === 'pull') {
          work.pulls.push({
            prKey: entry.candidate.key,
            scoutId: scout.id,
            scoutName: scout.name,
            configVersion: version?.version ?? 0,
            reason: answer.reason,
            pulledAt: this.deps.now().toISOString(),
            seenUpdatedAt: null,
            followedAt: null,
            dismissedAt: null,
            dismissReason: null,
            expiredAt: null,
            expiryReason: null,
          });
        }
      }
    }
  }

  /** The judgements, the pulls and (when the listing covered the window) the cursor, in one transaction. */
  private commit(scout: ScoutConfig, repo: string, work: ScoutRepoWork, listingComplete: boolean, runStart: IsoTime): string[] {
    const { store } = this.deps;
    const pulled: string[] = [];
    store.transaction(() => {
      for (const row of work.rows) {
        store.scoutJudgements.save(row);
      }
      for (const pull of work.pulls) {
        if (store.scoutedPrs.insert(pull)) {
          pulled.push(pull.prKey);
        }
      }
      if (listingComplete) {
        store.scoutCursors.advance(scout.id, repo, runStart, this.deps.now().toISOString());
      }
    });
    return pulled;
  }

  /** PRs PostPile already tracks normally: a notification thread, found by the sync, or followed from a scout. */
  private trackedKeys(): Set<PrKey> {
    const { store } = this.deps;
    return new Set([...threadsByPrKey(store.notifications.list()).keys(), ...store.foundPrs.listAll().keys(), ...store.scoutedPrs.followedKeys()]);
  }

  /**
   * Active scouted PRs whose updatedAt moved, or that have no snapshot yet,
   * fetched again. Returns the ones whose stored snapshot is now known to be
   * current: only those may expire.
   */
  private async refresh(alreadyStored: Set<PrKey>, errors: string[]): Promise<Set<PrKey>> {
    const keys = this.deps.store.scoutedPrs
      .listActive()
      .map((row) => row.prKey)
      .filter((key) => !alreadyStored.has(key));
    const current = new Set(alreadyStored);
    if (keys.length === 0 || !this.quotaAllows()) {
      return current;
    }
    let remote: Map<PrKey, IsoTime>;
    try {
      remote = await this.deps.reader.prUpdatedAts(keys.map(refOf));
    } catch (error) {
      errors.push(`scouts: refresh: ${errorText(error)}`);
      return current;
    }
    const stored = this.deps.store.prs.updatedAtByKey();
    const moved: PrKey[] = [];
    for (const key of keys) {
      const updatedAt = remote.get(key);
      if (updatedAt === undefined) {
        continue;
      }
      if (stored.get(key) === undefined || updatedAt > stored.get(key)!) {
        moved.push(key);
      } else {
        current.add(key);
      }
    }
    for (const key of await this.deps.storePrs(moved.map(refOf), errors)) {
      current.add(key);
    }
    return current;
  }

  /**
   * Takes scouted PRs off the board three days after their merge, close or
   * last activity, judged on snapshots this run checked against GitHub
   * (`current`): a stale snapshot after a failed refresh never expires one.
   * Returns how many.
   */
  private expire(current: ReadonlySet<PrKey>): number {
    const { store } = this.deps;
    const now = this.deps.now().toISOString();
    const active = store.scoutedPrs.listActive().filter((row) => current.has(row.prKey));
    const prs = store.prs.getMany(active.map((row) => row.prKey));
    let expired = 0;
    for (const row of active) {
      const pr = prs.get(row.prKey);
      const reason = pr ? scoutedExpiry(row, pr, now) : null;
      if (reason !== null && isScoutedActive(row) && store.scoutedPrs.expire(row.prKey, now, reason)) {
        expired += 1;
      }
    }
    return expired;
  }

  /**
   * "Check scout" (DESIGN.md "Scouts" › The intro card): the scout as the
   * sync would run it on the last `days` of its repos, with the same
   * listing, rules, file reads and judge, under `input.budget` (the caller
   * caps it). Writes NOTHING: no judgement, no pull, no cursor, no resume
   * point, no snapshot. A scout of the same id that exists is not
   * consulted: the trial judges as if it were new.
   */
  async trial(scout: ScoutConfig, days: number, input: Omit<ScoutRunInput, 'glance' | 'errors'>): Promise<ScoutTrial> {
    this.quotaAllows = input.quotaAllows;
    this.runFiles = new Map();
    const errors: string[] = [];
    const fresh: ScoutConfig = { ...scout, id: '__trial__' };
    const floor = new Date(this.deps.now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const facts = { viewer: input.viewer, tracked: this.trackedKeys() };
    const titles = new Map<PrKey, string>();
    const rows: ScoutJudgement[] = [];
    let listedWhole = true;
    for (const repo of fresh.repos) {
      const prs = new Map<PrKey, ScoutCandidate>();
      const end = await this.pass(repo, null, floor, { pages: SCOUT_LIST_MAX_PAGES }, prs, errors);
      listedWhole &&= end.kind === 'done';
      prs.forEach((pr) => titles.set(pr.key, pr.title));
      const work: ScoutRepoWork = { rows: [], pulls: [] };
      const items = await this.prepare(fresh, null, repo, [...prs.values()], facts, work);
      await this.judge(fresh, null, items, { ...input, errors, glance: async () => {} }, work);
      rows.push(...work.rows);
    }
    const pulled = rows.filter((row) => row.verdict === 'pulled');
    const pending = rows.filter((row) => row.status === 'pending');
    const judged = rows.filter((row) => row.attempts > 0 || row.status === 'judged').length;
    let problem: string | null = errors[0] ?? null;
    if (problem === null && !listedWhole) {
      problem = 'more PRs than one check lists';
    }
    if (problem === null && pending.length > 0) {
      problem = pending[0]!.lastError;
    }
    return {
      days,
      pulled: pulled.length,
      examples: pulled.slice(0, SCOUT_TRIAL_EXAMPLES).map((row) => ({ prKey: row.prKey, title: titles.get(row.prKey) ?? row.prKey, reason: row.reason ?? '' })),
      candidates: rows.length,
      judged,
      complete: listedWhole && pending.length === 0,
      problem,
    };
  }

  async run(input: ScoutRunInput): Promise<ScoutRunReport> {
    const { store, history } = this.deps;
    const report: ScoutRunReport = { listed: 0, judged: 0, pulled: 0, pending: 0, expired: 0 };
    const runStart = this.deps.now().toISOString();
    const active = history.active();
    if (active.errors.length > 0) {
      const using = active.version === null ? 'no scouts run' : `scouts from version ${active.version.version} run`;
      input.errors.push(`scouts.md: ${active.errors[0]}${active.errors.length > 1 ? ` (+${active.errors.length - 1} more)` : ''}; ${using} until it is fixed`);
    }
    this.quotaAllows = input.quotaAllows;
    this.runFiles = new Map();
    if (!this.quotaAllows()) {
      this.deps.log('scouts: GitHub quota low, skipped this sync');
      return report;
    }
    const pulled: PrKey[] = [];
    if (active.scouts.length > 0) {
      const facts = { viewer: input.viewer, tracked: this.trackedKeys() };
      const floors = new Map<string, IsoTime>();
      for (const scout of active.scouts) {
        for (const repo of scout.repos) {
          floors.set(`${scout.id} ${repo}`, scoutListingFloor(store.scoutCursors.get(scout.id, repo)?.coveredThrough ?? null, runStart));
        }
      }
      const listings = new Map<string, RepoListing>();
      for (const repo of new Set(active.scouts.flatMap((scout) => scout.repos))) {
        const oldest = active.scouts
          .filter((scout) => scout.repos.includes(repo))
          .map((scout) => floors.get(`${scout.id} ${repo}`)!)
          .sort()[0]!;
        const listing = await this.list(repo, oldest, runStart, input.errors);
        listings.set(repo, listing);
        report.listed += listing.prs.size;
      }
      // File order: an earlier scout wins a PR two would pull.
      for (const scout of active.scouts) {
        for (const repo of scout.repos) {
          const listing = listings.get(repo)!;
          const work: ScoutRepoWork = { rows: [], pulls: [] };
          const candidates = await this.candidatesFor(scout, repo, listing, floors.get(`${scout.id} ${repo}`)!);
          const items = await this.prepare(scout, active.version, repo, candidates, facts, work);
          await this.judge(scout, active.version, items, input, work);
          pulled.push(...this.commit(scout, repo, work, listing.complete, runStart));
          report.judged += work.rows.filter((row) => row.status === 'judged' && row.judgedAt !== null && row.judgedAt >= runStart).length;
          report.pending += work.rows.filter((row) => row.status === 'pending').length;
        }
      }
      report.pulled = pulled.length;
    }
    const stored = new Set(await this.deps.storePrs(pulled.map(refOf), input.errors));
    report.expired = this.expire(await this.refresh(stored, input.errors));
    store.scoutJudgements.deleteSkippedBefore(scoutRetentionCutoff(runStart));
    if (input.agentOff === null && store.scoutedPrs.listActive().length > 0) {
      await input.glance();
    }
    if (active.scouts.length > 0 || report.expired > 0) {
      this.deps.log(
        `scouts: ${active.scouts.length} scouts, ${report.listed} PRs listed, ${report.judged} judged, ${report.pulled} pulled in, ${report.pending} pending, ${report.expired} expired`,
      );
    }
    return report;
  }
}
