import { ALL_AGENT_JOBS, type SyncOptions, type SyncReport } from '@postpile/core';
import { noteSyncStart } from './actions/inbox-cleanup.ts';
import { AgentBudget } from './budget.ts';
import { reviveRetiredTopics } from './consolidation/revive.ts';
import type { DigestTally } from './digest/deps.ts';
import { Digester } from './digest/digester.ts';
import { errorText } from './errors.ts';
import { saveLastSyncReport, syncReportLogLines } from './last-sync-report.ts';
import type { GitHubSync } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { FactVerifier } from './memory/fact-verifier.ts';
import { emptyFactCounts } from './memory/fact-writer.ts';
import { advanceSeenFromGitHub } from './memory/seen-from-github.ts';
import type { RunDeps } from './run-deps.ts';

function emptyReport(startedAt: string, tally: DigestTally, errors: string[]): SyncReport {
  return {
    startedAt,
    finishedAt: startedAt,
    notificationsNotModified: false,
    threads: 0,
    prsFetched: 0,
    prsSkipped: 0,
    prsPulledIn: 0,
    prsFound: 0,
    newEvents: 0,
    agentCalls: 0,
    agentCallStats: { total: 0, byKind: {} },
    dossiersUpdated: 0,
    facts: tally.facts,
    errors,
  };
}

/** One sync: fetch -> verify facts -> agent digest. Tiles are derived on read. */
export class SyncRun {
  constructor(
    private readonly deps: RunDeps,
    private readonly github: GitHubSync,
    private readonly markReadQueue: MarkReadQueue,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  async run(options: SyncOptions): Promise<SyncReport> {
    const { store, now, callLog } = this.deps;
    const startedAt = now().toISOString();
    const errors: string[] = [];
    const tally: DigestTally = { dossiersUpdated: 0, facts: emptyFactCounts() };
    const report = emptyReport(startedAt, tally, errors);
    report.agentCallStats = callLog.begin(`sync:${startedAt}`);
    noteSyncStart(store, startedAt);
    this.log(`sync: started (max agent calls ${options.maxAgentCalls ?? 'unlimited'})`);
    try {
      const fetched = await this.github.run(options.maxPrs ?? Number.POSITIVE_INFINITY);
      report.notificationsNotModified = fetched.notModified;
      report.threads = fetched.threads;
      report.prsFetched = fetched.prsFetched;
      report.prsSkipped = fetched.prsSkipped;
      report.prsPulledIn = fetched.prsPulledIn;
      report.prsFound = fetched.prsFound;
      report.newEvents = fetched.newEventIds.length;
      errors.push(...fetched.errors);

      new FactVerifier(store, this.deps.facts, now).run(fetched.fetchedPrKeys, tally.facts);
      reviveRetiredTopics(store, fetched.newEventIds, now().toISOString());
      const digester = new Digester({
        store,
        agent: this.deps.agent,
        contexts: this.deps.contexts,
        budget: new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY, report.agentCallStats),
        facts: this.deps.facts,
        viewer: fetched.viewer,
        errors,
        tally,
        now,
      });
      await digester.run(options.agentJobs ?? ALL_AGENT_JOBS);
      // After the digest, so dossier changes about events already read on GitHub count as seen too.
      advanceSeenFromGitHub(store, fetched.readOnGitHub, now().toISOString());
    } catch (error) {
      errors.push(`sync: ${errorText(error)}`);
      // The stack only goes to the log; the report keeps the message.
      this.log(`sync: failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } finally {
      callLog.end();
    }
    // Mark-reads run in the background; the sync report is where the user hears about them.
    errors.push(...this.markReadQueue.takeNotes());
    report.agentCalls = report.agentCallStats.total;
    report.dossiersUpdated = tally.dossiersUpdated;
    report.finishedAt = now().toISOString();
    for (const line of syncReportLogLines(report)) {
      this.log(line);
    }
    try {
      saveLastSyncReport(store, report);
    } catch (error) {
      this.log(`sync: could not store the report: ${errorText(error)}`);
    }
    return report;
  }
}
