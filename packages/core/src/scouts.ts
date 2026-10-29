// Scouts (DESIGN.md "Scouts"): rules for pulling PRs from outside the GitHub
// inbox into PostPile. Which candidates a scout looks at, which path signals
// they carry, when a judged PR is judged again, how long judgements are
// kept, when a scouted PR leaves the board and which scout owns it. Rules
// only, no IO.
import { prOwners } from './pr-owners.ts';
import { isTeammate } from './review-request.ts';
import { sameLogin } from './mentions.ts';
import { shortHash } from './pr-notes.ts';
import type { ScoutConfig } from './scouts-config.ts';
import type { FoundPr, IsoTime, PrKey, PrState, Provenance, Viewer } from './types.ts';

/** GitHub's PatchStatus for a changed file. */
export type ScoutChangeType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'CHANGED';

export interface ScoutFile {
  path: string;
  changeType: ScoutChangeType;
}

/** A PR from a scout's repo listing, with its whole file list once that is read. */
export interface ScoutCandidate {
  key: PrKey;
  /** GitHub's node id of the PR: what Follow subscribes to. */
  nodeId: string;
  title: string;
  body: string;
  /** Login; "name[bot]" for an app account, "" for a deleted one. */
  author: string;
  /** Assigned users' logins: an agent PR belongs to them (`prOwners`). */
  assignees: string[];
  isDraft: boolean;
  state: PrState;
  headOid: string;
  baseOid: string;
  updatedAt: IsoTime;
  mergedAt: IsoTime | null;
}

/** One file that matched a path hint: the concrete pair the input hash covers. */
export interface ScoutSignal {
  path: string;
  changeType: ScoutChangeType;
  /** The hint as written, "+" included: "+*\/", "docs/architecture.md". */
  hint: string;
}

/** scouts.md as it was at some point: its history, like instructions_version. */
/** outside: found on disk (a hand edit); app: written by the app; intro: a scout turned on from the intro card. */
export type ScoutsOrigin = 'outside' | 'app' | 'intro';

export interface ScoutsVersion {
  /** 1, 2, 3, ... */
  version: number;
  text: string;
  summary: string;
  origin: ScoutsOrigin;
  createdAt: IsoTime;
}

/** How far one scout has covered one repo's listing. */
export interface ScoutCursor {
  scoutId: string;
  repo: string;
  /**
   * The run-start boundary of the last run that traversed its whole window
   * and stored every candidate as judged or pending. The next run lists
   * down to this minus `SCOUT_OVERLAP_MS`.
   */
  coveredThrough: IsoTime;
  updatedAt: IsoTime;
}

/** pending: waiting for files, a complete listing or a model answer; retried every run whatever the cursor says. */
export type ScoutJudgementStatus = 'pending' | 'judged';

export type ScoutVerdict = 'pulled' | 'skipped';

/** One scout's call on one PR. */
export interface ScoutJudgement {
  scoutId: string;
  prKey: PrKey;
  status: ScoutJudgementStatus;
  /** Null while pending. */
  verdict: ScoutVerdict | null;
  /** The model's reason, or a rule's ("no path signal"). Null while pending. */
  reason: string | null;
  /** `scoutInputHash` of what was judged; null while the files are not read in full. */
  inputHash: string | null;
  /** The scouts.md version the scout came from. */
  configVersion: number;
  headOid: string | null;
  /** The PR's updatedAt when it was last listed. Retention counts from it. */
  observedUpdatedAt: IsoTime;
  /** Model calls tried for it so far. */
  attempts: number;
  /** Why it is still pending, for the sync report. */
  lastError: string | null;
  judgedAt: IsoTime | null;
  /**
   * The pre-filter rule that skipped it before any read, else null. Such a
   * skip is no verdict on the PR: once the rule stops applying (a draft
   * marked ready, a PR no longer tracked) it is judged like a new one.
   */
  leftOut: ScoutPrefilterReason | null;
}

/** A PR a scout pulled in: what the board's Scouted section shows. One row per PR, first scout wins. */
export interface ScoutedPr {
  prKey: PrKey;
  scoutId: string;
  /** The scout's name when it pulled the PR, so the reason still reads after a rename or removal. */
  scoutName: string;
  configVersion: number;
  /** The model's reason, shown on the tile. */
  reason: string;
  pulledAt: IsoTime;
  /** Seen in PostPile through this PR updatedAt; it reads unseen again once the PR moves past it. Never a GitHub read. */
  seenUpdatedAt: IsoTime | null;
  /** Subscribed on GitHub through Follow (set only once the write went through). */
  followedAt: IsoTime | null;
  dismissedAt: IsoTime | null;
  dismissReason: string | null;
  expiredAt: IsoTime | null;
  expiryReason: ScoutExpiryReason | null;
}

export type ScoutExpiryReason = 'merged' | 'closed' | 'inactive';

/** Listing overlap below the cursor: catches PRs whose updatedAt landed late. */
export const SCOUT_OVERLAP_MS = 5 * 60 * 1000;
/** A scout's first run on a repo looks this far back. */
export const SCOUT_FIRST_RUN_HOURS = 24;
/** Skipped judgements are kept this long after the PR's last observed update, then deleted. */
export const SCOUT_SKIPPED_RETENTION_DAYS = 30;
/** A scouted PR nobody followed leaves the board after this long without activity, or after its merge or close. */
export const SCOUT_EXPIRY_DAYS = 3;
/** The part of a PR description the judge reads and the hash covers. */
export const SCOUT_BODY_HEAD_CHARS = 600;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dependency and merge-queue bots: their PRs are lockfile bumps and queue
 * merges, never what a scout prompt is about. Agent accounts that open PRs
 * for people are not on it; their PRs are work like anyone's.
 */
const SCOUT_SKIPPED_BOT = /^(dependabot|renovate|trunk-io|mergify|snyk-bot|pre-commit-ci|depfu|imgbot|greenkeeper)(\[bot\])?$/i;

/** Why a PR is left out of every scout before any file read or model call; null when it is a candidate. */
export type ScoutPrefilterReason = 'draft' | 'dependency_bot' | 'you' | 'your_team' | 'tracked';

export interface ScoutPrefilterFacts {
  viewer: Viewer;
  /** PRs PostPile already tracks normally: a notification thread, found by the sync, or followed from a scout. */
  tracked: ReadonlySet<PrKey>;
}

/**
 * The deterministic first cut, shared by every scout on the repo. Drafts
 * wait until they turn ready (that moves their updatedAt, so a later
 * listing sees them). The viewer's own and their teammates' PRs reach them
 * anyway, owned by the PR-ownership rules (`prOwners`: an agent PR is its
 * assignees'); tracked ones already have a tile.
 */
export function scoutPrefilter(candidate: Pick<ScoutCandidate, 'key' | 'author' | 'assignees' | 'isDraft' | 'state'>, facts: ScoutPrefilterFacts): ScoutPrefilterReason | null {
  if (candidate.state === 'OPEN' && candidate.isDraft) {
    return 'draft';
  }
  if (SCOUT_SKIPPED_BOT.test(candidate.author)) {
    return 'dependency_bot';
  }
  // Whose PR it is, as everywhere else: an agent PR belongs to the people it is assigned to.
  const owners = prOwners(candidate);
  if (owners.some((owner) => sameLogin(owner, facts.viewer.login))) {
    return 'you';
  }
  if (owners.some((owner) => isTeammate(owner, facts.viewer))) {
    return 'your_team';
  }
  if (facts.tracked.has(candidate.key)) {
    return 'tracked';
  }
  return null;
}

/** First path segment: "services/api/x.ts" -> "services". Null for a file at the top level. */
function topLevelFolder(path: string): string | null {
  const slash = path.indexOf('/');
  return slash <= 0 ? null : path.slice(0, slash);
}

/** ADDED, or RENAMED to this path: a file that was not there before. */
function isAdded(changeType: ScoutChangeType): boolean {
  return changeType === 'ADDED' || changeType === 'RENAMED';
}

/**
 * The files that match the scout's path hints, each file once (the first
 * hint that takes it). "+" hints take added or renamed-to files only. The
 * new-top-level-folder hint takes an added file whose first folder is not
 * a directory of the PR's base tree (`baseFolders`).
 */
export function scoutSignals(scout: Pick<ScoutConfig, 'paths'>, files: ScoutFile[], baseFolders: ReadonlySet<string>): ScoutSignal[] {
  const signals: ScoutSignal[] = [];
  for (const file of files) {
    const hint = scout.paths.find((candidate) => {
      if (candidate.addedOnly && !isAdded(file.changeType)) {
        return false;
      }
      if (candidate.newTopLevelFolder) {
        const folder = topLevelFolder(file.path);
        return folder !== null && !baseFolders.has(folder);
      }
      return candidate.regex?.test(file.path) ?? false;
    });
    if (hint) {
      signals.push({ path: file.path, changeType: file.changeType, hint: `${hint.addedOnly ? '+' : ''}${hint.pattern}` });
    }
  }
  return signals;
}

/** The start of a description the judge reads: trimmed, cut at SCOUT_BODY_HEAD_CHARS. */
export function scoutBodyHead(body: string): string {
  return body.trim().slice(0, SCOUT_BODY_HEAD_CHARS);
}

/** What the scout itself contributes to a judgement: its prompt, repos and path hints. A rename alone does not count. */
export function scoutDefinitionHash(scout: Pick<ScoutConfig, 'prompt' | 'repos' | 'paths'>): string {
  const paths = scout.paths.map((hint) => `${hint.addedOnly ? '+' : ''}${hint.pattern}`);
  return shortHash(JSON.stringify([scout.prompt, [...scout.repos].sort(), paths]));
}

/**
 * What a judgement read, as a hash: the scout's definition, the title, the
 * start of the body, and the matched (path, change type) pairs, or for a
 * scout without paths the whole file list. A changed hash judges again.
 * Content changes inside the same files do not (accepted recall trade-off,
 * DESIGN.md "Scouts"); a force-push that changes the file set does, since
 * the full current list is read again.
 */
export function scoutInputHash(scout: Pick<ScoutConfig, 'prompt' | 'repos' | 'paths'>, candidate: Pick<ScoutCandidate, 'title' | 'body'>, files: ScoutFile[], signals: ScoutSignal[]): string {
  const pairs = (scout.paths.length > 0 ? signals : files).map((file) => `${file.changeType} ${file.path}`).sort();
  return shortHash(JSON.stringify([scoutDefinitionHash(scout), candidate.title, scoutBodyHead(candidate.body), pairs]));
}

/** What a scout does with a PR whose files are read, before any model call. */
export type ScoutJudgeStep =
  /** This scout pulled it already: the board has it, the refresh keeps it current. */
  | 'already_pulled'
  /** Judged before with the same input: nothing new for this scout. */
  | 'unchanged'
  /** The scout has path hints and none matched: skipped by rule, no model call. */
  | 'no_signal'
  /** Ask the model. */
  | 'judge';

/**
 * The re-judge decision. A pending judgement is always worked on, whatever
 * its hash. A scout with path hints skips a PR without a signal by rule.
 */
export function scoutJudgeStep(input: {
  existing: Pick<ScoutJudgement, 'status' | 'inputHash'> | null;
  pulledByThisScout: boolean;
  inputHash: string;
  hasPathHints: boolean;
  signals: number;
}): ScoutJudgeStep {
  if (input.pulledByThisScout) {
    return 'already_pulled';
  }
  if (input.existing?.status === 'judged' && input.existing.inputHash === input.inputHash) {
    return 'unchanged';
  }
  if (input.hasPathHints && input.signals === 0) {
    return 'no_signal';
  }
  return 'judge';
}

/**
 * The oldest updatedAt a run lists down to: the cursor minus the overlap,
 * or SCOUT_FIRST_RUN_HOURS before the run started when the scout never
 * covered the repo. Inclusive: a PR updated exactly then is listed.
 */
export function scoutListingFloor(coveredThrough: IsoTime | null, runStart: IsoTime): IsoTime {
  if (coveredThrough === null) {
    return new Date(Date.parse(runStart) - SCOUT_FIRST_RUN_HOURS * 60 * 60 * 1000).toISOString();
  }
  return new Date(Date.parse(coveredThrough) - SCOUT_OVERLAP_MS).toISOString();
}

/** Skipped judgements whose PR was last seen updated before this are deleted. */
export function scoutRetentionCutoff(now: IsoTime): IsoTime {
  return new Date(Date.parse(now) - SCOUT_SKIPPED_RETENTION_DAYS * DAY_MS).toISOString();
}

/**
 * Why a scouted PR leaves the board now, or null while it stays. Only for
 * one still on it: not followed, not dismissed, not expired. Merged: three
 * days after the merge, so a fast merge still shows as merged for a while.
 * Closed: three days after the close (its updatedAt). Open: three days
 * without activity on GitHub. Opening it in PostPile does not keep it.
 */
export function scoutedExpiry(scouted: Pick<ScoutedPr, 'followedAt' | 'dismissedAt' | 'expiredAt'>, pr: { state: PrState; updatedAt: IsoTime; mergedAt: IsoTime | null }, now: IsoTime): ScoutExpiryReason | null {
  if (scouted.followedAt !== null || scouted.dismissedAt !== null || scouted.expiredAt !== null) {
    return null;
  }
  const olderThanExpiry = (at: IsoTime) => Date.parse(now) - Date.parse(at) >= SCOUT_EXPIRY_DAYS * DAY_MS;
  if (pr.state === 'MERGED') {
    return olderThanExpiry(pr.mergedAt ?? pr.updatedAt) ? 'merged' : null;
  }
  if (pr.state === 'CLOSED') {
    return olderThanExpiry(pr.updatedAt) ? 'closed' : null;
  }
  return olderThanExpiry(pr.updatedAt) ? 'inactive' : null;
}

/** A scouted PR still on the board: not followed, dismissed or expired. */
export function isScoutedActive(scouted: Pick<ScoutedPr, 'followedAt' | 'dismissedAt' | 'expiredAt'>): boolean {
  return scouted.followedAt === null && scouted.dismissedAt === null && scouted.expiredAt === null;
}

/**
 * What a "pull" verdict does. One row per PR: the first scout to pull it
 * owns it (scouts run in file order). A later scout only records its own
 * judgement. A dismissed or expired PR stays with its scout and is not
 * pulled again.
 */
export function scoutPullStep(existing: Pick<ScoutedPr, 'scoutId'> | null, scoutId: string): 'pull' | 'already_pulled' | 'pulled_by_other' {
  if (existing === null) {
    return 'pull';
  }
  return existing.scoutId === scoutId ? 'already_pulled' : 'pulled_by_other';
}

/** Unseen in PostPile: never opened, or GitHub activity after the update it was seen through. */
export function isScoutedUnseen(scouted: Pick<ScoutedPr, 'seenUpdatedAt'>, prUpdatedAt: IsoTime): boolean {
  return scouted.seenUpdatedAt === null || scouted.seenUpdatedAt < prUpdatedAt;
}

/**
 * A scouted PR as a found PR, for its tile on the scout's section: found
 * outside the inbox, by a scout. `via: 'scouted'` is never stored in
 * pr_found, so it never makes the PR tracked anywhere else.
 */
export function scoutedFound(scouted: Pick<ScoutedPr, 'prKey' | 'scoutName' | 'reason' | 'pulledAt'>): FoundPr {
  return { prKey: scouted.prKey, via: 'scouted', reason: `scout "${scouted.scoutName}" pulled it in: ${scouted.reason}`, foundAt: scouted.pulledAt };
}

/** How a scouted PR reached the user, for its glance: the same words as its tile's (`scoutedFound`). */
export function scoutedProvenance(scouted: Pick<ScoutedPr, 'prKey' | 'scoutName' | 'reason' | 'pulledAt'>): Provenance {
  const found = scoutedFound(scouted);
  return { kind: 'found', via: found.via, reason: found.reason };
}

/** The Board's pseudo-topic of one scout, like Unsorted: "scout:<id>". */
export const SCOUT_TOPIC_PREFIX = 'scout:';

export function scoutTopicId(scoutId: string): string {
  return `${SCOUT_TOPIC_PREFIX}${scoutId}`;
}

/** The scout behind a pseudo-topic id; null for any other topic. */
export function scoutIdOfTopic(topicId: string): string | null {
  return topicId.startsWith(SCOUT_TOPIC_PREFIX) ? topicId.slice(SCOUT_TOPIC_PREFIX.length) : null;
}

/**
 * Which scout shows a stack none of whose layers is tracked (DESIGN.md
 * "Scouts" › Stacks): the scout that pulled any of its layers first, so the
 * stack shows whole in one place. A stack with a tracked layer shows in its
 * normal topic instead (the caller checks that first). Null when no layer
 * is scouted.
 */
export function scoutStackOwner(layers: PrKey[], scouted: ReadonlyMap<PrKey, Pick<ScoutedPr, 'scoutId' | 'pulledAt'>>): string | null {
  const rows = layers.flatMap((key) => {
    const row = scouted.get(key);
    return row ? [row] : [];
  });
  rows.sort((a, b) => a.pulledAt.localeCompare(b.pulledAt) || a.scoutId.localeCompare(b.scoutId));
  return rows[0]?.scoutId ?? null;
}

/** Where a Follow stands: waiting out its undo window, waiting for the writes lock, or failed and waiting to be sent again. */
export type ScoutFollowState = 'queued' | 'pending' | 'failed';

/** One row of the sidebar's Scouted section. */
export interface ScoutListItem {
  id: string;
  /** "scout:<id>": opens like a topic. */
  topicId: string;
  name: string;
  /** PRs on its section: active scouted PRs PostPile does not track otherwise (a stack counts each layer). */
  tiles: number;
  /** Of those, the ones not seen in PostPile since their last activity. A grey count, never coral. */
  unseen: number;
}

/** The scout part of a scouted tile, shown in the "for whom" spot. */
export interface TileScout {
  scoutId: string;
  scoutName: string;
  /** The model's reason, from the first scouted PR of the tile. */
  reason: string;
  /** A PR of the tile is unseen in PostPile. */
  unseen: boolean;
  /** The scouted PRs of the tile: what Follow and Dismiss act on. */
  prKeys: PrKey[];
  /** A Follow of one of them that has not reached GitHub yet; null when none. */
  follow: ScoutFollowState | null;
}

/** What the PR pane and the MCP say about a PR a scout pulled in. */
export interface ScoutedPrView {
  scoutId: string;
  scoutName: string;
  reason: string;
  pulledAt: IsoTime;
  /** Still on the Scouted section. */
  active: boolean;
  followedAt: IsoTime | null;
  dismissedAt: IsoTime | null;
  dismissReason: string | null;
  expiredAt: IsoTime | null;
  expiryReason: ScoutExpiryReason | null;
  /** Unseen in PostPile since its last activity. */
  unseen: boolean;
  /** Tracked normally now: in the GitHub inbox, found by the sync, or followed. */
  tracked: boolean;
  /** It has a notification thread: GitHub's inbox holds it, not only PostPile's tracking. */
  inInbox: boolean;
  follow: ScoutFollowState | null;
}

export function scoutedPrView(row: ScoutedPr, prUpdatedAt: IsoTime, place: Pick<ScoutedPrView, 'tracked' | 'inInbox'>, follow: ScoutFollowState | null): ScoutedPrView {
  return {
    scoutId: row.scoutId,
    scoutName: row.scoutName,
    reason: row.reason,
    pulledAt: row.pulledAt,
    active: isScoutedActive(row),
    followedAt: row.followedAt,
    dismissedAt: row.dismissedAt,
    dismissReason: row.dismissReason,
    expiredAt: row.expiredAt,
    expiryReason: row.expiryReason,
    unseen: isScoutedUnseen(row, prUpdatedAt),
    tracked: place.tracked,
    inInbox: place.inInbox,
    follow,
  };
}

/** A dismiss reason as stored: whitespace folded, at most 200 characters, null when empty. */
export function cleanDismissReason(reason: string | null | undefined): string | null {
  const folded = (reason ?? '').replace(/\s+/g, ' ').trim();
  return folded === '' ? null : folded.slice(0, 200);
}

/** One line on a scouted PR for the MCP and the pane: "Scouted by Lookout: adds billing/. Not in the user's GitHub inbox." */
export function scoutedLine(view: Pick<ScoutedPrView, 'scoutName' | 'reason' | 'tracked' | 'inInbox' | 'active' | 'followedAt' | 'dismissedAt' | 'expiredAt'>): string {
  const first = `Scouted by ${view.scoutName}: ${view.reason}.`;
  if (view.inInbox) {
    return `${first} It reached the user's GitHub inbox since.`;
  }
  if (view.followedAt !== null) {
    return `${first} Followed on GitHub since; not in the user's GitHub inbox yet.`;
  }
  if (view.tracked) {
    return `${first} PostPile tracks it now; not in the user's GitHub inbox.`;
  }
  if (view.dismissedAt !== null) {
    return `${first} Dismissed by the user.`;
  }
  if (view.expiredAt !== null) {
    return `${first} Off the Scouted section now.`;
  }
  return `${first} Not in the user's GitHub inbox.`;
}

/** One piece of scout work that needs a file read and a model call: a scout's candidate on one repo. */
export interface ScoutWorkItem {
  /** A retry of a pending judgement, as opposed to a new or moved candidate. */
  pending: boolean;
  /** When the PR was observed: pending retries go oldest first. */
  observedUpdatedAt: IsoTime;
  /**
   * A pending retry whose last try failed before the model call (its file
   * list or base tree could not be read): it waits behind other work.
   */
  stalled: boolean;
}

/** Why a pending row's last try stopped before the model call: its reads failed, not the judge. */
export const SCOUT_FILES_NOT_READ = 'file list not read whole';
export const SCOUT_TREE_NOT_READ = 'base tree not read';

/** A pending row whose last try failed in the reads, so the next run puts it behind other work. */
export function scoutRetryStalled(row: Pick<ScoutJudgement, 'status' | 'lastError'>): boolean {
  return row.status === 'pending' && (row.lastError === SCOUT_FILES_NOT_READ || row.lastError === SCOUT_TREE_NOT_READ);
}

/**
 * Which work one run takes on, when there is more than it can judge
 * (DESIGN.md "Scouts" › Scheduling). Each queue is one scout on one repo,
 * in scouts.md order: its pending retries first, oldest observed first,
 * then its new candidates in the order given, then the stalled retries
 * (their reads failed last time), oldest first: a PR GitHub keeps failing
 * to read only takes slots nothing else needs. The run takes one item from
 * each queue in turn, round-robin, until `capacity` (the calls left times
 * the batch size) is used, so no scout, repo or wave of new PRs starves the
 * rest. Everything not taken waits for the next run without a file read.
 */
export function scheduleScoutWork<T extends ScoutWorkItem>(queues: T[][], capacity: number): Set<T> {
  const oldestFirst = (a: T, b: T) => a.observedUpdatedAt.localeCompare(b.observedUpdatedAt);
  const ordered = queues.map((queue) => [
    ...queue.filter((item) => item.pending && !item.stalled).sort(oldestFirst),
    ...queue.filter((item) => !item.pending),
    ...queue.filter((item) => item.pending && item.stalled).sort(oldestFirst),
  ]);
  const taken = new Set<T>();
  let round = 0;
  while (taken.size < capacity && ordered.some((queue) => queue.length > round)) {
    for (const queue of ordered) {
      const item = queue[round];
      if (item !== undefined && taken.size < capacity) {
        taken.add(item);
      }
    }
    round += 1;
  }
  return taken;
}

/**
 * A scouted PR wants a glance while it is on the Scouted section, open,
 * merged or closed: it is there to be looked at. A merge changes its glance
 * input, so it gets one fresh glance after the merge. Inbox PRs keep
 * `prWantsGlance`.
 */
export function scoutedWantsGlance(scouted: Pick<ScoutedPr, 'followedAt' | 'dismissedAt' | 'expiredAt'>): boolean {
  return isScoutedActive(scouted);
}
