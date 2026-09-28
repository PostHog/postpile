// Fakes for engine tests. Nothing here touches GitHub or the claude CLI.
import { FakeRunner } from '@code-manager/agent';
import type { NotificationThread, Pr, PrKey, PrRef, Viewer } from '@code-manager/core';
import { FakeTimers, viewer as fixtureViewer } from '@code-manager/core/fixtures';
import type {
  BranchLookup,
  BranchPr,
  GitHubReader,
  GitHubWriter,
  NotificationConditions,
  NotificationsResult,
  TeamMembersResult,
} from '@code-manager/github';
import { Store } from '@code-manager/store';
import { AgentCallLog } from '../agent-call-log.ts';
import { Engine } from '../engine.ts';
import { MarkReadQueue } from '../mark-read-queue.ts';
import { FakeAgent } from './fake-agent.ts';

function toBranchPr(pr: Pr): BranchPr {
  return { ref: pr.ref, state: pr.state, mergedAt: pr.mergedAt, updatedAt: pr.updatedAt, baseRef: pr.baseRef, headRef: pr.headRef };
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

  async getThread(threadId: string): Promise<NotificationThread | null> {
    return this.threads.find((thread) => thread.id === threadId) ?? null;
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

  async findPrsByBranch(lookups: BranchLookup[]): Promise<BranchPr[][]> {
    this.branchLookups.push(lookups);
    return lookups.map((lookup) => {
      if (lookup.side === 'head' && lookup.branch === this.defaultBranch) {
        return [];
      }
      return [...this.prs.values()]
        .filter((pr) => pr.ref.repo === lookup.repo && pr.state !== 'CLOSED')
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

  async approvePr(ref: PrRef, _body: string, commitOid: string): Promise<void> {
    this.calls.push(`approvePr ${ref.repo}#${ref.number}@${commitOid}`);
  }

  async commentOnPr(ref: PrRef, body: string): Promise<void> {
    this.calls.push(`commentOnPr ${ref.repo}#${ref.number} ${body}`);
  }
}

export interface Harness {
  engine: Engine;
  store: Store;
  reader: FakeReader;
  writer: FakeWriter;
  runner: FakeRunner;
  agent: FakeAgent;
  timers: FakeTimers;
}

export const NOW = new Date('2026-09-02T12:00:00Z');

export interface HarnessOptions {
  instructionsFile?: string;
  /** Clock for the engine; tests move it forward by changing what it returns. */
  now?: () => Date;
  pingDecisionsPerDay?: number;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const instructionsFile = options.instructionsFile ?? '/nonexistent/instructions.md';
  const now = options.now ?? (() => NOW);
  const store = Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const runner = new FakeRunner();
  const timers = new FakeTimers();
  const markReadQueue = new MarkReadQueue(writer, reader, timers, undefined, (threadId, readAt) =>
    store.notifications.markRead(threadId, readAt),
  );
  const callLog = new AgentCallLog(store, now);
  const agent = new FakeAgent(runner, callLog);
  const engine = new Engine({
    store,
    reader,
    writer,
    agent,
    callLog,
    markReadQueue,
    instructionsFile,
    now,
    timers,
    pingDecisionsPerDay: options.pingDecisionsPerDay,
  });
  return { engine, store, reader, writer, runner, agent, timers };
}
