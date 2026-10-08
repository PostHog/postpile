// Fakes for engine tests. Nothing here touches GitHub or the claude CLI.
import { FakeRunner } from '@postpile/agent';
import type {
  ActivityPr,
  McpLauncher,
  NotificationThread,
  FullPr,
  PrKey,
  PrRef,
  ReviewedPr,
  TelemetryEventName,
  TelemetryEventProps,
  Viewer,
  ViewerTeamSize,
} from '@postpile/core';
import type { RendererExceptionProps } from '@postpile/core';
import type { IsoTime } from '@postpile/core';
import { prKey } from '@postpile/core';
import { FakeTimers, viewer as fixtureViewer } from '@postpile/core/fixtures';
import type {
  BranchLookup,
  BranchPr,
  CapFill,
  CodeOwnersFile,
  GitHubReader,
  PartialPrs,
  PrDiffRead,
  GitHubWriter,
  NotificationConditions,
  NotificationsResult,
  TeamMembersResult,
  ThreadsSinceResult,
  FoundRef,
} from '@postpile/github';
import type { UserConfigFile } from '../user-config.ts';
import type { CommandResult, CommandRunner } from '../setup/setup-checks.ts';
import type { Telemetry, TelemetryPersonInfo } from '../telemetry/telemetry.ts';
import { Store } from '@postpile/store';
import { putBackNotTaken } from '../actions/local-change.ts';
import { AgentCallLog } from '../agent-call-log.ts';
import { Engine } from '../engine.ts';
import { loadSetupFlag, saveSetupFlag } from '../setup/setup-flag.ts';
import { GitHubQuota } from '../github-quota.ts';
import { ToolHealth } from '../tools/tool-health.ts';
import { MarkReadQueue } from '../mark-read-queue.ts';
import { ActionLog } from '../writes/action-log.ts';
import { GitHubWrites } from '../writes/github-writes.ts';
import { PendingWrites } from '../writes/pending-writes.ts';
import { WriteSwitch } from '../writes/write-switch.ts';
import { FakeAgent } from './fake-agent.ts';
import { TOPIC_GRAIN_KEY, TOPIC_GRAIN_VERSION } from '../digest/topic-tidy.ts';

function toBranchPr(pr: FullPr): BranchPr {
  return {
    ref: pr.ref,
    state: pr.state,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    updatedAt: pr.updatedAt,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    previousBaseRefs: pr.previousBaseRefs ?? [],
  };
}

export class FakeReader implements GitHubReader {
  threads: NotificationThread[] = [];
  prs = new Map<PrKey, FullPr>();
  etag = 'etag-1';
  fetchedRefs: PrRef[][] = [];
  /** Every findPrsByBranch call, one entry per batch. */
  branchLookups: BranchLookup[][] = [];
  /** Head lookups on this branch answer nothing, like the real client on a repo's default branch. */
  defaultBranch = 'master';
  /** Logins per "org/slug"; a team missing here answers an empty list. */
  teams = new Map<string, string[]>();
  /** Every teamMembers call as [team, etag sent]. */
  teamCalls: [string, string | null][] = [];
  /** Set to make teamMembers throw, like a network error. */
  teamError: Error | null = null;
  /** PRs whose batch fails in fetchPrsPartial, like GitHub's "Something went wrong" timeout. */
  failingPrs = new Set<PrKey>();

  /** What viewer() answers; tests may swap it, e.g. for more teams. */
  constructor(public who: Viewer = fixtureViewer) {}

  addPr(pr: FullPr, thread: NotificationThread): void {
    this.prs.set(pr.key, pr);
    this.threads = [thread, ...this.threads.filter((t) => t.id !== thread.id)];
  }

  /** A PR on GitHub the user has no notification for, e.g. another layer of a stack. */
  addStackPr(pr: FullPr): void {
    this.prs.set(pr.key, pr);
  }

  async viewer(): Promise<Viewer> {
    return this.who;
  }

  async teamMembers(team: string, etag: string | null): Promise<TeamMembersResult> {
    this.teamCalls.push([team, etag]);
    if (this.teamError) {
      throw this.teamError;
    }
    const logins = this.teams.get(team) ?? [];
    const tag = `team-etag:${logins.join(',')}`;
    return etag === tag ? { notModified: true } : { notModified: false, logins, etag: tag };
  }

  /** X-Poll-Interval on every answer. */
  pollIntervalSeconds: number | null = 60;
  /** Thrown by the next listNotifications, then cleared. */
  failNext: Error | null = null;
  notificationCalls = 0;
  /** Runs on every listNotifications, e.g. to note the rate-limit headers a real answer carries. */
  onListNotifications: (() => void) | null = null;

  async listNotifications(conditions: NotificationConditions): Promise<NotificationsResult> {
    this.notificationCalls += 1;
    this.onListNotifications?.();
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const pollIntervalSeconds = this.pollIntervalSeconds;
    if (conditions.etag === this.etag) {
      return { notModified: true, pollIntervalSeconds };
    }
    return { notModified: false, threads: this.threads, etag: this.etag, lastModified: null, pollIntervalSeconds };
  }

  /** Threads the read-list call answers (read and unread); defaults to `threads`. */
  readList: NotificationThread[] | null = null;
  readListEtag = 'read-etag-1';
  /** Every listThreadsSince call as [since, etag sent]. */
  readListCalls: [string, string | null][] = [];

  async listThreadsSince(since: string, etag: string | null): Promise<ThreadsSinceResult> {
    this.readListCalls.push([since, etag]);
    if (etag === this.readListEtag) {
      return { notModified: true };
    }
    const threads = (this.readList ?? this.threads).filter((thread) => thread.updatedAt >= since);
    return { notModified: false, threads, etag: this.readListEtag };
  }

  /** What findPrs answers; set with addFoundPr. */
  found: FoundRef[] = [];
  /** Every findPrs call as [teams, mergedSince]. */
  findCalls: [string[], string][] = [];
  /** Set to make findPrs throw. */
  findError: Error | null = null;

  /** A PR on GitHub without a notification, which the finder query returns. */
  addFoundPr(pr: FullPr, via: FoundRef['via'], reason: string): void {
    this.prs.set(pr.key, pr);
    this.found = [...this.found.filter((entry) => `${entry.ref.repo}#${entry.ref.number}` !== pr.key), { ref: pr.ref, updatedAt: pr.updatedAt, via, reason }];
  }

  async findPrs(teams: string[], mergedSince: string): Promise<FoundRef[]> {
    this.findCalls.push([teams, mergedSince]);
    if (this.findError) {
      throw this.findError;
    }
    return this.found.map((entry) => ({ ...entry, updatedAt: this.prs.get(`${entry.ref.repo}#${entry.ref.number}`)?.updatedAt ?? entry.updatedAt }));
  }

  async getThread(threadId: string): Promise<NotificationThread | null> {
    return this.threads.find((thread) => thread.id === threadId) ?? null;
  }

  /** Every prUpdatedAts call, one entry per call. */
  updatedAtCalls: PrRef[][] = [];

  async prUpdatedAts(refs: PrRef[]): Promise<Map<PrKey, string>> {
    this.updatedAtCalls.push(refs);
    const result = new Map<PrKey, string>();
    for (const ref of refs) {
      const pr = this.prs.get(`${ref.repo}#${ref.number}`);
      if (pr) {
        result.set(pr.key, pr.updatedAt);
      }
    }
    return result;
  }

  async fetchPrs(refs: PrRef[]): Promise<Map<PrKey, FullPr>> {
    this.fetchedRefs.push(refs);
    const result = new Map<PrKey, FullPr>();
    for (const ref of refs) {
      const pr = this.prs.get(`${ref.repo}#${ref.number}`);
      if (pr) {
        result.set(pr.key, pr);
      }
    }
    return result;
  }

  async fetchPrsPartial(refs: PrRef[], onBatch: (prs: number) => void = () => {}): Promise<PartialPrs> {
    const failing = refs.filter((ref) => this.failingPrs.has(`${ref.repo}#${ref.number}`));
    const prs = await this.fetchPrs(refs.filter((ref) => !failing.includes(ref)));
    const errors = failing.map((ref) => `1 PRs from ${ref.repo}#${ref.number}: GitHub PR batch query failed: Something went wrong`);
    // One batch for the whole call.
    onBatch(prs.size);
    return { prs, errors };
  }

  /** What fillCappedLists answers per PR: the snapshot with its older pages merged in. A PR missing here gains nothing. */
  filledPrs = new Map<PrKey, FullPr>();
  /** Every fillCappedLists call as [PR key, since]. */
  fillCalls: [PrKey, IsoTime | null][] = [];

  async fillCappedLists(pr: FullPr, since: IsoTime | null): Promise<CapFill> {
    this.fillCalls.push([pr.key, since]);
    const filled = this.filledPrs.get(pr.key) ?? pr;
    return { pr: filled, pages: filled === pr ? 0 : 1 };
  }

  async findPrsByBranch(lookups: BranchLookup[]): Promise<BranchPr[][]> {
    this.branchLookups.push(lookups);
    return lookups.map((lookup) => {
      if (lookup.side === 'head' && lookup.branch === this.defaultBranch) {
        return [];
      }
      return [...this.prs.values()]
        .filter((pr) => pr.ref.repo === lookup.repo)
        .filter((pr) => (lookup.side === 'head' ? pr.headRef : pr.baseRef) === lookup.branch)
        .map(toBranchPr);
    });
  }

  /** Every findPrsByNumber call, one entry per call. */
  numberLookups: PrRef[][] = [];

  async findPrsByNumber(refs: PrRef[]): Promise<(BranchPr | null)[]> {
    this.numberLookups.push(refs);
    return refs.map((ref) => {
      const pr = [...this.prs.values()].find((stored) => stored.ref.repo === ref.repo && stored.ref.number === ref.number);
      return pr && !pr.isCrossRepository ? toBranchPr(pr) : null;
    });
  }

  /** What recentActivity answers (setup sweep). */
  activity: ActivityPr[] = [];
  /** Every recentActivity call's `since`. */
  activityCalls: string[] = [];
  /** What readPrDiff answers per PR key; a PR missing here has an empty diff. */
  diffs = new Map<PrKey, PrDiffRead>();
  /** Every readPrDiff call as a PR key. */
  diffCalls: PrKey[] = [];
  /** Set to make readPrDiff throw, like a network error. */
  diffError: Error | null = null;

  async readPrDiff(ref: PrRef): Promise<PrDiffRead> {
    this.diffCalls.push(prKey(ref));
    if (this.diffError) {
      throw this.diffError;
    }
    return this.diffs.get(prKey(ref)) ?? { files: [], capped: false };
  }

  /** File texts by "owner/name:path" for readRepoFile. */
  files = new Map<string, string>();
  /** Every readRepoFile call as "owner/name:path". */
  fileCalls: string[] = [];
  /** What probeNotifications answers: null means the token can read notifications. */
  notificationsProblem: string | null = null;

  async recentActivity(since: string): Promise<ActivityPr[]> {
    this.activityCalls.push(since);
    return this.activity;
  }

  async readRepoFile(repo: string, path: string): Promise<string | null> {
    this.fileCalls.push(`${repo}:${path}`);
    return this.files.get(`${repo}:${path}`) ?? null;
  }

  async probeNotifications(): Promise<string | null> {
    return this.notificationsProblem;
  }

  /** CODEOWNERS per repo (lower case) for codeOwnersFiles; a repo missing here has none. */
  codeOwners = new Map<string, CodeOwnersFile>();
  /** Every codeOwnersFiles call's repos. */
  codeOwnersCalls: string[][] = [];

  async codeOwnersFiles(repos: string[]): Promise<Map<string, CodeOwnersFile | null>> {
    this.codeOwnersCalls.push(repos);
    return new Map(repos.map((repo) => [repo, this.codeOwners.get(repo) ?? null]));
  }

  /** Member counts for teamSizes; a team missing here has an unknown size. */
  teamSizeCounts = new Map<string, number>();
  /** What reviewedPrRequests answers. */
  reviewed: ReviewedPr[] = [];
  /** Every reviewedPrRequests call as [login, orgs, since, cap]. */
  reviewedCalls: [string, string[], string, number][] = [];
  /** Set to make the team role reads throw. */
  teamRolesError: Error | null = null;
  /** How often teamSizes was asked: every classification starts with it. */
  teamSizeCalls = 0;

  async teamSizes(_login: string): Promise<ViewerTeamSize[]> {
    this.teamSizeCalls += 1;
    if (this.teamRolesError) {
      throw this.teamRolesError;
    }
    return this.who.teams.map((team) => ({ team, members: this.teamSizeCounts.get(team) ?? null }));
  }

  async reviewedPrRequests(login: string, orgs: string[], since: string, cap: number): Promise<ReviewedPr[]> {
    this.reviewedCalls.push([login, orgs, since, cap]);
    if (this.teamRolesError) {
      throw this.teamRolesError;
    }
    return this.reviewed.slice(0, cap);
  }
}

export class FakeWriter implements GitHubWriter {
  readonly calls: string[] = [];
  /** markThreadRead throws for these ids. */
  readonly failingThreads = new Set<string>();
  /** PR keys whose approve throws, like a GitHub error or timeout. */
  readonly failingApprovals = new Set<string>();
  /** removeTeamReviewRequest throws while set. */
  failRemoveTeamRequest = false;
  /** unsubscribeThread throws while set. */
  failUnsubscribe = false;
  /** subscribeThread throws while set. */
  failSubscribe = false;

  async markThreadRead(threadId: string): Promise<void> {
    if (this.failingThreads.has(threadId)) {
      throw new Error(`boom ${threadId}`);
    }
    this.calls.push(`markThreadRead ${threadId}`);
  }

  async markAllReadBefore(lastReadAt: string): Promise<void> {
    this.calls.push(`markAllReadBefore ${lastReadAt}`);
  }

  async markRepoReadBefore(repo: string, lastReadAt: string): Promise<void> {
    this.calls.push(`markRepoReadBefore ${repo} ${lastReadAt}`);
  }

  async approvePr(ref: PrRef, body: string, commitOid: string): Promise<void> {
    if (this.failingApprovals.has(`${ref.repo}#${ref.number}`)) {
      throw new Error('GitHub timed out');
    }
    this.calls.push(`approvePr ${ref.repo}#${ref.number}@${commitOid}${body === '' ? '' : ` ${body}`}`);
  }

  async commentReviewPr(ref: PrRef, body: string, commitOid: string): Promise<void> {
    this.calls.push(`commentReviewPr ${ref.repo}#${ref.number}@${commitOid} ${body}`);
  }

  async commentOnPr(ref: PrRef, body: string): Promise<void> {
    this.calls.push(`commentOnPr ${ref.repo}#${ref.number} ${body}`);
  }

  async replyInThread(threadId: string, body: string): Promise<void> {
    this.calls.push(`replyInThread ${threadId} ${body}`);
  }

  async addThumbsUp(subjectId: string): Promise<void> {
    this.calls.push(`addThumbsUp ${subjectId}`);
  }

  async removeTeamReviewRequest(ref: PrRef, teamSlug: string): Promise<void> {
    if (this.failRemoveTeamRequest) {
      throw new Error('boom: remove team request');
    }
    this.calls.push(`removeTeamReviewRequest ${ref.repo}#${ref.number} ${teamSlug}`);
  }

  async unsubscribeThread(threadId: string): Promise<void> {
    if (this.failUnsubscribe) {
      throw new Error('boom: unsubscribe');
    }
    this.calls.push(`unsubscribeThread ${threadId}`);
  }

  async subscribeThread(threadId: string): Promise<void> {
    if (this.failSubscribe) {
      throw new Error('boom: subscribe');
    }
    this.calls.push(`subscribeThread ${threadId}`);
  }
}

/**
 * gh and claude for the setup checks and the tool status, without running
 * anything: every program answers ok with "<name> version 1.0" unless listed
 * in `missing` or `failing`, or given a canned stdout in `answers`. Programs
 * are matched by name, so "/usr/bin/gh auth token" counts as "gh auth token",
 * and calls are recorded that way too.
 */
export class FakeCommands {
  readonly calls: string[] = [];
  readonly missing = new Set<string>();
  /** "gh auth token" style command lines that fail. */
  readonly failing = new Set<string>();
  /** "claude --version" style command lines with their stdout. */
  readonly answers = new Map<string, string>();

  readonly run: CommandRunner = async (command, args): Promise<CommandResult> => {
    const name = command.split('/').pop() ?? command;
    const line = [name, ...args].join(' ');
    this.calls.push(line);
    if (this.missing.has(name)) {
      return { ok: false, missing: true, stdout: '', stderr: '' };
    }
    if (this.failing.has(line)) {
      return { ok: false, missing: false, stdout: this.answers.get(line) ?? '', stderr: 'not logged in' };
    }
    const answer = this.answers.get(line);
    if (answer !== undefined) {
      return { ok: true, missing: false, stdout: answer, stderr: '' };
    }
    return { ok: true, missing: false, stdout: args.includes('token') ? 'gho_test\n' : `${name} version 1.0\n`, stderr: '' };
  };

  /** For the tool status: a program counts as on PATH unless it is in `missing`. */
  readonly isExecutable = (file: string): boolean => !this.missing.has(file.split('/').pop() ?? file);
}

export const NOW = new Date('2026-09-02T12:00:00Z');

/** GitHubWrites over a fake writer, on unless told otherwise. */
export function makeWrites(store: Store, writer: GitHubWriter, now: () => Date = () => NOW, enabled = true): GitHubWrites {
  const writeSwitch = new WriteSwitch(store, writer);
  writeSwitch.set(enabled);
  return new GitHubWrites(writeSwitch, new ActionLog(store, now));
}

/** Records every call instead of sending anything, so engine tests can assert on what telemetry fired. */
export class FakeTelemetry implements Telemetry {
  events: { event: TelemetryEventName; props: unknown }[] = [];
  personInfo: TelemetryPersonInfo[] = [];
  aliasedTo: number[] = [];
  exceptions: unknown[] = [];
  rendererExceptions: RendererExceptionProps[] = [];
  shutdownCalls = 0;

  capture<K extends TelemetryEventName>(event: K, props: TelemetryEventProps<K>): void {
    this.events.push({ event, props });
  }

  identifyPerson(info: TelemetryPersonInfo): void {
    this.personInfo.push(info);
  }

  setViewerIdentity(githubDatabaseId: number): void {
    this.aliasedTo.push(githubDatabaseId);
  }

  captureException(error: unknown): void {
    this.exceptions.push(error);
  }

  captureRendererException(report: RendererExceptionProps): void {
    this.rendererExceptions.push(report);
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }
}

export interface Harness {
  engine: Engine;
  store: Store;
  reader: FakeReader;
  writer: FakeWriter;
  writes: GitHubWrites;
  runner: FakeRunner;
  agent: FakeAgent;
  timers: FakeTimers;
  commands: FakeCommands;
  tools: ToolHealth;
  telemetry: FakeTelemetry;
  /** On the harness timers; tests feed it readings with note(). */
  quota: GitHubQuota;
}

export interface HarnessOptions {
  instructionsFile?: string;
  /** The store was opened read-only, as in the MCP process: the engine must not record anything. */
  storeReadOnly?: boolean;
  /** Clock for the engine; tests move it forward by changing what it returns. */
  now?: () => Date;
  pingDecisionsPerDay?: number;
  /** Daily glance catch-up cap; 0 (the default here) keeps catch-up off, so poll tests see only the poll's calls. */
  catchUpCallsPerDay?: number;
  /** One call per topic for dossier and first glances (POSTPILE_TOPIC_DIGEST=1). Off by default. */
  topicDigest?: boolean;
  /** The store predates the current topic grain, so the next full sync runs the topic tidy. Off by default. */
  topicTidyDue?: boolean;
  /**
   * GitHub writes on (the default here, so action tests reach FakeWriter).
   * false stores no choice: locked, as in a dev run, unless `writesOnByDefault`.
   */
  writesEnabled?: boolean;
  /** The packaged app's default: a store with no choice has writes on. Off here, like a dev run. */
  writesOnByDefault?: boolean;
  /** Build the switch with no real writer, like POSTPILE_READ_ONLY=1. */
  forcedReadOnly?: boolean;
  /** Reuse a store, e.g. to check what survives a restart. */
  store?: Store;
  /** Fake ~/.claude for the work context sweep. Defaults to a path that does not exist. */
  claudeDir?: string;
  /** Gets the sync's log lines (start, summary, errors). */
  syncLog?: (line: string) => void;
  /** The user's config.json; none by default, so tests never read a real one. */
  userConfig?: UserConfigFile;
  /** Defaults to a fresh FakeTelemetry, exposed on the harness either way. */
  telemetry?: FakeTelemetry;
  /** No setup flag, as on a first run: setup shows and the poll waits. Off by default, so tests start past setup. */
  firstRun?: boolean;
  /** How Claude Code starts the MCP server; none by default, so nothing runs claude mcp. */
  mcpLauncher?: McpLauncher;
  /** Where agent requests arrive; none by default, so startAgentRequests does nothing. */
  agentRequestsFolder?: string;
  /** Hold a start sync for the inbox catch-up dialog, as the app does. Off by default, like the CLI. */
  catchUpGate?: boolean;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const instructionsFile = options.instructionsFile ?? '/nonexistent/instructions.md';
  const now = options.now ?? (() => NOW);
  const store = options.store ?? Store.open(':memory:');
  // Stores start tidied to the current topic grain, as a fresh install ends up: only tidy tests opt in.
  if (!options.store && !options.topicTidyDue) {
    store.meta.set(TOPIC_GRAIN_KEY, String(TOPIC_GRAIN_VERSION));
  }
  if (!options.firstRun && loadSetupFlag(store) === null) {
    saveSetupFlag(store, 'done', now().toISOString());
  }
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const writeSwitch = new WriteSwitch(store, options.forcedReadOnly ? null : writer, options.writesOnByDefault ?? false);
  if (options.writesEnabled ?? true) {
    writeSwitch.set(true);
  }
  const writes = new GitHubWrites(writeSwitch, new ActionLog(store, now));
  const runner = new FakeRunner();
  const timers = new FakeTimers();
  const pendingWrites = new PendingWrites(store, writes, now);
  const markReadQueue = new MarkReadQueue(
    writes,
    reader,
    timers,
    undefined,
    (threadId, readAt) => store.notifications.markRead(threadId, readAt),
    (batch) => pendingWrites.park(batch),
    (thread, local) => putBackNotTaken(store, thread, local),
  );
  const callLog = new AgentCallLog(store, now);
  const agent = new FakeAgent(runner, callLog);
  const commands = new FakeCommands();
  const tools = new ToolHealth({ commands: commands.run, now, path: () => '/usr/bin', isExecutable: commands.isExecutable, claudeBinary: 'claude', log: () => {} });
  const telemetry = options.telemetry ?? new FakeTelemetry();
  const quota = new GitHubQuota(
    () => timers.now(),
    (resource, level) => telemetry.capture('github_quota_low', { resource, level }),
  );
  const engine = new Engine({
    store,
    reader,
    writes,
    agent,
    callLog,
    markReadQueue,
    pendingWrites,
    instructionsFile,
    storeReadOnly: options.storeReadOnly,
    now,
    timers,
    pingDecisionsPerDay: options.pingDecisionsPerDay,
    catchUpCallsPerDay: options.catchUpCallsPerDay ?? 0,
    topicDigest: options.topicDigest ?? false,
    claudeDir: options.claudeDir ?? '/nonexistent/claude',
    syncLog: options.syncLog ?? (() => {}),
    userConfig: options.userConfig ?? null,
    setupCommands: commands.run,
    mcpLauncher: options.mcpLauncher ?? null,
    tools,
    telemetry,
    quota,
    agentRequestsFolder: options.agentRequestsFolder ?? null,
    catchUpGate: options.catchUpGate ?? false,
    catchUpPaceMs: 0,
  });
  return { engine, store, reader, writer, writes, runner, agent, timers, commands, tools, telemetry, quota };
}
