// Fakes for engine tests. Nothing here touches GitHub or the claude CLI.
import { FakeRunner, RunnerAgentService } from '@code-manager/agent';
import type { NotificationThread, Pr, PrKey, PrRef, Viewer } from '@code-manager/core';
import { FakeTimers, viewer as fixtureViewer } from '@code-manager/core/fixtures';
import type { GitHubReader, GitHubWriter, NotificationConditions, NotificationsResult } from '@code-manager/github';
import { Store } from '@code-manager/store';
import { Engine } from '../engine.ts';
import { MarkReadQueue } from '../mark-read-queue.ts';

export class FakeReader implements GitHubReader {
  threads: NotificationThread[] = [];
  prs = new Map<PrKey, Pr>();
  etag = 'etag-1';
  fetchedRefs: PrRef[][] = [];

  constructor(private readonly who: Viewer = fixtureViewer) {}

  addPr(pr: Pr, thread: NotificationThread): void {
    this.prs.set(pr.key, pr);
    this.threads = [thread, ...this.threads.filter((t) => t.id !== thread.id)];
  }

  async viewer(): Promise<Viewer> {
    return this.who;
  }

  async listNotifications(conditions: NotificationConditions): Promise<NotificationsResult> {
    if (conditions.etag === this.etag) {
      return { notModified: true };
    }
    return { notModified: false, threads: this.threads, etag: this.etag, lastModified: null };
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
  timers: FakeTimers;
}

export const NOW = new Date('2026-09-02T12:00:00Z');

export function makeHarness(instructionsFile = '/nonexistent/instructions.md'): Harness {
  const store = Store.open(':memory:');
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const runner = new FakeRunner();
  const timers = new FakeTimers();
  const markReadQueue = new MarkReadQueue(writer, reader, timers, undefined, (threadId, readAt) =>
    store.notifications.markRead(threadId, readAt),
  );
  const engine = new Engine({
    store,
    reader,
    writer,
    agent: new RunnerAgentService(runner, { now: () => NOW.toISOString() }),
    markReadQueue,
    instructionsFile,
    now: () => NOW,
  });
  return { engine, store, reader, writer, runner, timers };
}

export function glanceAnswer(verdict = 'LOOKS_SAFE'): unknown {
  return { verdict, forYou: 'Small change.', does: 'Does a thing.', risk: 'Low.', othersSaid: 'Nothing yet.' };
}
