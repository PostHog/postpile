import type { AgentService, ContextSweepTopic } from '@postpile/agent';
import { dossierBrief, type ActionResult, type SweepHistory, type SweepSkipSource, type WorkContextSweepResult } from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import type { InstructionsHistory } from '../instructions/history.ts';
import { WorkContextCollector, type CollectBudget } from './collector.ts';
import { forgottenThreads } from './forgotten.ts';
import type { UserConfigFile } from '../user-config.ts';
import { resolveSweepSkip, SweepSkipList } from './skip-list.ts';

/** Meta key: the last failed sweep as JSON {message, at}. Cleared by the next success. */
export const SWEEP_ERROR_KEY = 'work_context_last_error';

export interface SweepError {
  message: string;
  at: string;
}

export interface WorkContextSweeperDeps {
  store: Store;
  agent: AgentService;
  history: InstructionsHistory;
  claudeDir: string;
  now: () => Date;
  /** Only tests pass these. */
  home?: string;
  budget?: CollectBudget;
  /** The user's config.json, read on every sweep for the skip list. Null or missing: none (tests, sample data). */
  config?: UserConfigFile | null;
  /** Read for POSTPILE_SWEEP_SKIP. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** The skip list in use and where it comes from. */
export interface SweepSkipSettings {
  patterns: string[];
  source: SweepSkipSource;
  configFile: string | null;
}

/**
 * The daily "what you're working on" sweep: collect local Claude Code
 * material, one context_sweep call, store the answer as a new version. A
 * failure keeps the previous version and is remembered for the UI. Never
 * waits for a sync, and a sync never waits for it.
 */
export class WorkContextSweeper {
  private running: Promise<WorkContextSweepResult> | null = null;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: WorkContextSweeperDeps) {
    this.log = deps.log ?? ((message) => console.log(message));
  }

  /** Read fresh each time: POSTPILE_SWEEP_SKIP, else the config file, else the defaults. */
  skipSettings(): SweepSkipSettings {
    const config = this.deps.config ?? null;
    const resolved = resolveSweepSkip((this.deps.env ?? process.env).POSTPILE_SWEEP_SKIP, config?.read().sweepSkip);
    return { ...resolved, configFile: config?.path ?? null };
  }

  /** Saves the skip list to the config file; the next sweep uses it. */
  saveSkipPatterns(patterns: string[]): ActionResult {
    const config = this.deps.config ?? null;
    if (!config) {
      return { ok: false, message: 'No config file here: the skip list cannot be saved.', undoToken: null };
    }
    try {
      config.setSweepSkip(patterns);
    } catch (error) {
      return { ok: false, message: `Could not save ${config.path}: ${errorText(error)}`, undoToken: null };
    }
    const overridden = this.skipSettings().source === 'env' ? ' POSTPILE_SWEEP_SKIP is set and still wins until it is unset.' : '';
    return { ok: true, message: `Skip list saved to ${config.path}.${overridden}`, undoToken: null };
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  lastError(): SweepError | null {
    const raw = this.deps.store.meta.get(SWEEP_ERROR_KEY);
    return raw ? (JSON.parse(raw) as SweepError) : null;
  }

  history(): SweepHistory {
    return {
      lastSuccessAt: this.deps.store.workContext.latest()?.createdAt ?? null,
      lastFailureAt: this.lastError()?.at ?? null,
    };
  }

  /** A sweep while one runs joins it. */
  sweep(): Promise<WorkContextSweepResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private topics(): ContextSweepTopic[] {
    const { store } = this.deps;
    const topics = store.topics.listActive();
    const dossiers = store.dossiers.latestMany(topics.map((topic) => topic.id));
    return topics.map((topic) => {
      const dossier = dossiers.get(topic.id);
      return { id: topic.id, name: topic.name, about: dossier ? dossierBrief(dossier.dossier) : topic.summary };
    });
  }

  private async run(): Promise<WorkContextSweepResult> {
    const { store, agent, now } = this.deps;
    const collector = new WorkContextCollector({
      claudeDir: this.deps.claudeDir,
      now: now(),
      home: this.deps.home,
      budget: this.deps.budget,
      skipList: new SweepSkipList(this.skipSettings().patterns),
      log: this.log,
    });
    let stats: WorkContextSweepResult['stats'] = null;
    try {
      const collected = await collector.collect();
      stats = collected.stats;
      const previous = store.workContext.latest();
      const answer = await agent.sweepContext({
        items: collected.items,
        instructions: this.deps.history.current().text,
        topics: this.topics(),
        forgotten: forgottenThreads(store),
        previous: previous?.digest ?? null,
        lastSeenAt: collected.lastSeenAt,
        now: now().toISOString(),
      });
      const stored = store.workContext.add({
        digest: answer.digest,
        inputSources: collected.items.map((item) => ({ kind: item.kind, ref: item.ref })),
        inputStats: collected.stats,
        model: answer.model,
        createdAt: now().toISOString(),
      });
      store.meta.delete(SWEEP_ERROR_KEY);
      const message = `Work context v${stored.version}: ${answer.digest.threads.length} threads from ${collected.stats.sentChars} chars`;
      this.log(message);
      return { ok: true, message, version: stored.version, stats };
    } catch (error) {
      const message = `Work context sweep failed: ${errorText(error)}`;
      this.log(message);
      try {
        store.meta.set(SWEEP_ERROR_KEY, JSON.stringify({ message, at: now().toISOString() } satisfies SweepError));
      } catch {
        // The database closed under a sweep still running at quit; nothing to keep.
      }
      return { ok: false, message, version: null, stats };
    }
  }
}
