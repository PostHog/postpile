import type {
  ActionResult,
  Topic,
  WorkContextInputStats,
  WorkContextSweepResult,
  WorkContextThread,
  WorkContextView,
  WorkThreadForget,
} from '@postpile/core';
import { DEFAULT_SWEEP_SKIP, resolveSweepSkip } from '@postpile/engine';
import { SampleClock } from './sample-builders.ts';

/** The real defaults, so fake mode shows what a real sweep skips. */
const SAMPLE_SKIP = DEFAULT_SWEEP_SKIP;

const STATS: WorkContextInputStats = {
  budgetChars: 60_000,
  sentChars: 41_230,
  claudeMdFiles: 2,
  memoryFiles: 18,
  sessions: 26,
  sessionFilesScanned: 61,
  maskedSecrets: 1,
  droppedCount: 3,
  dropped: [
    { kind: 'session', ref: 'web · 2026-09-21 16:46', reason: 'started by a program (SDK)' },
    { kind: 'session', ref: 'infra · 2026-09-25 10:56 · "Runner image bump ⑂"', reason: 'same prompts as a newer session (fork)' },
    { kind: 'memory', ref: '~/.claude/projects/-Users-sample-workspace-web/memory/old-notes.md', reason: 'over budget' },
  ],
  skippedProjects: 2,
  skipPatterns: SAMPLE_SKIP,
};

const SUMMARY =
  'Moving the monorepo CI to Depot is the main thread: backend and frontend jobs run there, Turbo caching and e2e are next. ' +
  'Shard splitting for the test suite is being reworked alongside. ' +
  'Waiting on reviews for the release workflow and the ingestion CI runners RFC. ' +
  'Cares most about CI cost, cache keys and anything that loosens CI limits.';

function sampleThreads(topics: Topic[]): WorkContextThread[] {
  const id = (name: string) => topics.find((topic) => topic.name === name)?.id;
  const ids = (...names: string[]) => names.map(id).filter((value): value is string => value !== undefined);
  return [
    {
      title: 'Depot CI rollout',
      detail: 'Backend and frontend jobs are on Depot; Turbo remote cache and Playwright shards are in review. Release workflow has no PR yet.',
      topicIds: ids('Move CI to Depot', 'Frontend build'),
      sources: [
        { kind: 'session', ref: 'app · 2026-09-27 10:01 · "runner pool sizing"' },
        { kind: 'memory', ref: '~/.claude/projects/-Users-sample-workspace-app/memory/depot.md' },
      ],
    },
    {
      title: 'Test shard splitting',
      detail: 'Reworking how the backend suite splits into shards; one shard grew too big and slowed the run.',
      topicIds: ids('CI & tests'),
      sources: [{ kind: 'session', ref: 'ci-tools · 2026-09-24 09:04 · "test splitting"' }],
    },
    {
      title: 'Ingestion runners RFC',
      detail: 'Waiting on the ingestion team to answer the runner sizing questions before approving.',
      topicIds: ids('Ingestion CI runners RFC'),
      sources: [{ kind: 'memory', ref: '~/.claude/projects/-Users-sample-workspace-app/memory/MEMORY.md' }],
    },
    {
      title: 'How reviews should read',
      detail: 'Short, neutral PR descriptions and conventional commits; platform wording in titles.',
      topicIds: [],
      sources: [{ kind: 'claude_md', ref: '~/.claude/CLAUDE.md' }],
    },
  ];
}

/**
 * "What you're working on" for FakeEngine: one sample digest linked to the
 * sample topics. Refresh takes a moment and stamps a new version; Forget
 * marks the thread like the real engine does. Nothing reads ~/.claude.
 */
export class FakeWorkContext {
  private version = 3;
  private createdAt: string;
  private readonly forgotten = new Set<number>();
  private running = false;
  /** Saved skip list; sample data has no config file, so it lives in memory. Undefined until saved. */
  private savedSkip: string[] | undefined = undefined;

  /** `env` is read fresh on every view, like the real sweep: POSTPILE_SWEEP_SKIP wins over the saved list. */
  constructor(
    private readonly topics: Topic[],
    private readonly now: () => Date,
    private readonly refreshDelayMs: number,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.createdAt = new SampleClock(now()).hoursAgo(3);
  }

  private skipSettings() {
    return resolveSweepSkip(this.env.POSTPILE_SWEEP_SKIP, this.savedSkip);
  }

  view(): WorkContextView {
    const names = new Map(this.topics.map((topic) => [topic.id, topic.name]));
    const skip = this.skipSettings();
    return {
      current: {
        version: this.version,
        createdAt: this.createdAt,
        model: 'opus (sample)',
        summary: SUMMARY,
        lastSeenAt: this.createdAt,
        inputStats: { ...STATS, skipPatterns: skip.patterns },
        threads: sampleThreads(this.topics).map((thread, index) => ({
          index,
          title: thread.title,
          detail: thread.detail,
          topics: thread.topicIds.map((id) => ({ id, name: names.get(id) ?? id })),
          sources: thread.sources,
          forgotten: this.forgotten.has(index),
        })),
      },
      lastError: null,
      running: this.running,
      skipPatterns: skip.patterns,
      skipSource: skip.source,
      skipConfigFile: '~/.config/postpile/config.json (sample data: kept in memory)',
    };
  }

  setSkip(patterns: string[]): ActionResult {
    this.savedSkip = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern !== '');
    const overridden = this.skipSettings().source === 'env' ? ' POSTPILE_SWEEP_SKIP is set and still wins until it is unset.' : '';
    return { ok: true, message: `Skip list saved (sample data: in memory only).${overridden}`, undoToken: null };
  }

  async sweep(): Promise<WorkContextSweepResult> {
    this.running = true;
    await new Promise((resolve) => setTimeout(resolve, this.refreshDelayMs));
    this.running = false;
    this.version += 1;
    this.createdAt = this.now().toISOString();
    return { ok: true, message: `Work context v${this.version} (sample data)`, version: this.version, stats: STATS };
  }

  forget(input: WorkThreadForget): { result: ActionResult; undo: () => void } | null {
    const thread = sampleThreads(this.topics)[input.index];
    if (input.version !== this.version || !thread) {
      return null;
    }
    this.forgotten.add(input.index);
    return {
      result: { ok: true, message: `Forgot "${thread.title}". The next sweep leaves it out.`, undoToken: null },
      undo: () => this.forgotten.delete(input.index),
    };
  }
}
