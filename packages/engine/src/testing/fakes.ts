// Fakes for engine tests. Nothing here touches GitHub or the claude CLI.
import { FakeRunner } from '@postpile/agent';
import type { NotificationThread, Pr, PrKey, PrRef, Viewer } from '@postpile/core';
import { FakeTimers, viewer as fixtureViewer } from '@postpile/core/fixtures';
import type {
  BranchLookup,
  BranchPr,
  GitHubReader,
  PartialPrs,
  GitHubWriter,
  NotificationConditions,
  NotificationsResult,
  TeamMembersResult,
  ThreadsSinceResult,
  FoundRef,
} from '@postpile/github';
import type { UserConfigFile } from '../user-config.ts';
import { Store } from '@postpile/store';
import { putBackNotTaken } from '../actions/local-change.ts';
import { AgentCallLog } from '../agent-call-log.ts';
import { Engine } from '../engine.ts';
import { MarkReadQueue } from '../mark-read-queue.ts';
import { ActionLog } from '../writes/action-log.ts';
import { GitHubWrites } from '../writes/github-writes.ts';
import { PendingWrites } from '../writes/pending-writes.ts';
import { WriteSwitch } from '../writes/write-switch.ts';
import { FakeAgent } from './fake-agent.ts';

function toBranchPr(pr: Pr): BranchPr {
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
  prs = new Map<PrKey, Pr>();
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

  constructor(private readonly who: Viewer = fixtureViewer) {}

  addPr(pr: Pr, thread: NotificationThread): void {
    this.prs.set(pr.key, pr);
    this.threads = [thread, ...this.threads.filter((t) => t.id !== thread.id)];
  }

  /** A PR on GitHub the user has no notification for, e.g. another layer of a stack. */
  addStackPr(pr: Pr): void {
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

  async listNotifications(conditions: NotificationConditions): Promise<NotificationsResult> {
    this.notificationCalls += 1;
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
  addFoundPr(pr: Pr, via: FoundRef['via'], reason: string): void {
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

  async fetchPrs(refs: PrRef[]): Promise<Map<PrKey, Pr>> {
    this.fetchedRefs.push(refs);
    const result = new Map<PrKey, Pr>();
    for (const ref of refs) {
      const pr = this.prs.get(`${ref.repo}#${ref.number}`);
      if (pr) {
        result.set(pr.key, pr);
      }
    }
    return result;
  }

  async fetchPrsPartial(refs: PrRef[]): Promise<PartialPrs> {
    const failing = refs.filter((ref) => this.failingPrs.has(`${ref.repo}#${ref.number}`));
    const prs = await this.fetchPrs(refs.filter((ref) => !failing.includes(ref)));
    const errors = failing.map((ref) => `1 PRs from ${ref.repo}#${ref.number}: GitHub PR batch query failed: Something went wrong`);
    return { prs, errors };
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
}

export class FakeWriter implements GitHubWriter {
  readonly calls: string[] = [];
  /** markThreadRead throws for these ids. */
  readonly failingThreads = new Set<string>();

  async markThreadRead(threadId: string): Promise<void> {
    if (this.failingThreads.has(threadId)) {
      throw new Error(`boom ${threadId}`);
    }
    this.calls.push(`markThreadRead ${threadId}`);
  }

  async markAllReadBefore(lastReadAt: string): Promise<void> {
    this.calls.push(`markAllReadBefore ${lastReadAt}`);
  }

  async approvePr(ref: PrRef, _body: string, commitOid: string): Promise<void> {
    this.calls.push(`approvePr ${ref.repo}#${ref.number}@${commitOid}`);
  }

  async commentOnPr(ref: PrRef, body: string): Promise<void> {
    this.calls.push(`commentOnPr ${ref.repo}#${ref.number} ${body}`);
  }
}

export const NOW = new Date('2026-09-02T12:00:00Z');

/** GitHubWrites over a fake writer, on unless told otherwise. */
export function makeWrites(store: Store, writer: GitHubWriter, now: () => Date = () => NOW, enabled = true): GitHubWrites {
  const writeSwitch = new WriteSwitch(store, writer);
  writeSwitch.set(enabled);
  return new GitHubWrites(writeSwitch, new ActionLog(store, now));
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
}

export interface HarnessOptions {
  instructionsFile?: string;
  /** Clock for the engine; tests move it forward by changing what it returns. */
  now?: () => Date;
  pingDecisionsPerDay?: number;
  /** GitHub writes on (the default here, so action tests reach FakeWriter) or off, as on a first real run. */
  writesEnabled?: boolean;
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
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const instructionsFile = options.instructionsFile ?? '/nonexistent/instructions.md';
  const now = options.now ?? (() => NOW);
  const store = options.store ?? Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const writeSwitch = new WriteSwitch(store, options.forcedReadOnly ? null : writer);
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
  const engine = new Engine({
    store,
    reader,
    writes,
    agent,
    callLog,
    markReadQueue,
    pendingWrites,
    instructionsFile,
    now,
    timers,
    pingDecisionsPerDay: options.pingDecisionsPerDay,
    claudeDir: options.claudeDir ?? '/nonexistent/claude',
    syncLog: options.syncLog ?? (() => {}),
    userConfig: options.userConfig ?? null,
  });
  return { engine, store, reader, writer, writes, runner, agent, timers };
}
