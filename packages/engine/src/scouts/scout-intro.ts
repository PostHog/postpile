import {
  emptyAgentCallStats,
  mainRepoOf,
  parsePrKey,
  scoutFromCard,
  scoutIntroAutoShows,
  scoutNameWithId,
  SCOUT_TRIAL_DAYS,
  SCOUT_TRIAL_JUDGE_CALLS,
  type ActionResult,
  type AgentCallStats,
  type ScoutCheckRequest,
  type ScoutCheckResult,
  type ScoutDraftResult,
  type ScoutIntroState,
  type ScoutTrial,
  type ScoutTurnOnRequest,
  type TelemetryEventProps,
} from '@postpile/core';
import type { AgentService } from '@postpile/agent';
import type { Store } from '@postpile/store';
import { failed, ok } from '../actions/results.ts';
import type { AgentCallLog } from '../agent-call-log.ts';
import { Board } from '../board.ts';
import { AgentBudget, type CallAllowance } from '../budget.ts';
import { errorText } from '../errors.ts';
import type { Telemetry } from '../telemetry/telemetry.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { loadRepoSettings } from '../repo-settings.ts';
import type { UserConfigFile } from '../user-config.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { ScoutsHistory } from './history.ts';
import { ScoutRun, type ScoutRunDeps } from './scout-run.ts';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** Repos one scout may watch from the card. */
const MAX_REPOS = 5;

export interface ScoutIntroDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  /** Null without a scouts file (tests): nothing can be turned on. */
  history: ScoutsHistory | null;
  /** Null without a scouts file: the check runs no dry run. Each check builds its own ScoutRun from these. */
  scoutRunDeps: ScoutRunDeps | null;
  /** A check's calls count in a run of their own, never in a sync running meanwhile. */
  callLog: AgentCallLog;
  /** Null in tests: the dismissal is kept in memory. */
  userConfig: UserConfigFile | null;
  /** The daily allowance the intro's agent calls take from, like glance catch-ups; `remaining` sizes the dry run before it reads. */
  allowance: CallAllowance & { remaining(): number };
  agentOff: () => string | null;
  quotaAllows: () => boolean;
  /** scout_checked for every check that ran (counts and enums only). */
  telemetry: Telemetry;
  now: () => Date;
  log: (line: string) => void;
}

/** Why a check ran no dry run, as scout_checked reports it. */
type DryRunSkipped = NonNullable<TelemetryEventProps<'scout_checked'>['dry_run_skipped_reason']>;

/** The dry run, or why none ran; neither for a scout that would not turn on as written (refused before, so not expected). */
interface TrialOutcome {
  trial: ScoutTrial | null;
  skipped: DryRunSkipped | null;
}

/** scout_checked's props: the verdict, whether a part can't be seen, and the dry run's pulls or why it did not run. */
function scoutCheckedProps(result: ScoutCheckResult, skipped: DryRunSkipped | null): TelemetryEventProps<'scout_checked'> {
  const props: TelemetryEventProps<'scout_checked'> = { fit: result.fit.verdict, cant_see: result.cantSee !== null };
  if (skipped !== null) {
    return { ...props, dry_run_skipped_reason: skipped };
  }
  if (result.trial === null) {
    return props;
  }
  return { ...props, dry_run_pulls: result.trial.pulled, dry_run_complete: result.trial.complete };
}

/**
 * The Scouts intro card (DESIGN.md "Scouts" › The intro card): when it
 * opens by itself, its drafted prompt, "Check scout" (the agent's check
 * plus a dry run that writes nothing) and "Turn on scout", which appends
 * the scout to scouts.md through its history.
 */
export class ScoutIntro {
  /** Without a user config file (tests), the answer lives as long as the process. */
  private dismissedInMemory: string | null = null;

  constructor(private readonly deps: ScoutIntroDeps) {}

  private dismissedAt(): string | null {
    return this.deps.userConfig?.read().scoutsIntroDismissedAt ?? this.dismissedInMemory;
  }

  private remember(): void {
    const at = this.deps.now().toISOString();
    if (this.deps.userConfig) {
      this.deps.userConfig.setScoutsIntroDismissedAt(at);
    } else {
      this.dismissedInMemory = at;
    }
  }

  /** Repos on the board, most PRs first. */
  private knownRepos(board: Board): string[] {
    const counts = new Map<string, number>();
    for (const key of board.prs.keys()) {
      const repo = parsePrKey(key).repo;
      counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([repo]) => repo);
  }

  state(): ScoutIntroState {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    const scouts = this.deps.history?.active().scouts.length ?? 0;
    // Setup stores the main repo as the repo scope; with "All repos" the board's busiest repo stands in.
    const mainRepo = loadRepoSettings(this.deps.store).scope ?? mainRepoOf([...board.prs.keys()]);
    return { autoShow: scoutIntroAutoShows({ dismissedAt: this.dismissedAt(), scouts }), mainRepo, repos: this.knownRepos(board), scouts };
  }

  /** The textarea's first text: one agent call from the user's instructions and work context, under the daily allowance. */
  async draft(): Promise<ScoutDraftResult> {
    if (this.deps.agentOff() !== null) {
      return { text: null, why: 'agent_off' };
    }
    const viewer = loadViewer(this.deps.store);
    if (viewer === null || !this.deps.allowance.take()) {
      return { text: null, why: 'capped' };
    }
    const mainRepo = this.state().mainRepo;
    try {
      const text = await this.deps.agent.draftScout({
        viewer,
        context: this.deps.contexts.forTopic(null),
        topics: this.deps.store.topics.listActive().map((topic) => topic.name),
        repos: mainRepo ? [mainRepo] : [],
      });
      return text.trim() === '' ? { text: null, why: 'failed' } : { text, why: 'drafted' };
    } catch {
      return { text: null, why: 'failed' };
    }
  }

  /** The repos asked for, checked; null when one is not owner/name or there are none or too many. */
  private cleanRepos(repos: string[]): string[] | null {
    const unique = [...new Set(repos.map((repo) => repo.trim()))].filter((repo) => repo !== '');
    if (unique.length === 0 || unique.length > MAX_REPOS || unique.some((repo) => !REPO.test(repo))) {
      return null;
    }
    return unique;
  }

  /**
   * "Check scout": the agent's check of the prompt, then the dry run over
   * the last SCOUT_TRIAL_DAYS days with at most SCOUT_TRIAL_JUDGE_CALLS
   * judge calls, all under the daily allowance. Saves nothing.
   */
  async check(request: ScoutCheckRequest): Promise<ScoutCheckResult> {
    const stats = emptyAgentCallStats();
    return this.deps.callLog.withRun(`scout-check:${this.deps.now().toISOString()}`, stats, () => this.checkInRun(request, stats));
  }

  private async checkInRun(request: ScoutCheckRequest, stats: AgentCallStats): Promise<ScoutCheckResult> {
    const refused = (message: string): ScoutCheckResult => ({ ok: false, message, fit: { verdict: 'partly', note: '' }, cantSee: null, name: '', paths: [], trial: null });
    const repos = this.cleanRepos(request.repos);
    const prompt = request.prompt.trim();
    if (repos === null || prompt === '') {
      return refused('Pick one to five repos (owner/name) and say what to look out for.');
    }
    const off = this.deps.agentOff();
    if (off !== null) {
      return refused(`Agent features are off: ${off}`);
    }
    const viewer = loadViewer(this.deps.store);
    if (viewer === null) {
      return refused('PostPile has not read GitHub yet; check again after the first sync.');
    }
    // The same read-back as Turn on, before any call or read: a prompt that would not turn on is not checked either.
    const asWritten = scoutFromCard({ name: 'My scout', prompt, repos, paths: [] });
    if ('error' in asWritten) {
      return refused(`This scout could not be turned on as written: ${asWritten.error}`);
    }
    if (!this.deps.allowance.take()) {
      return refused("Today's agent calls are used up; check again tomorrow, or turn it on unchecked from scouts.md.");
    }
    let checked;
    try {
      checked = await this.deps.agent.checkScout({ prompt, repos, viewer, context: this.deps.contexts.forTopic(null) });
    } catch (error) {
      return refused(`The check failed: ${errorText(error)}`);
    }
    // The name field's start must turn on as is: an id it can slug, not one another scout has.
    const takenIds = new Set(this.deps.history?.active().scouts.map((scout) => scout.id) ?? []);
    const name = scoutNameWithId(checked.name, repos, takenIds);
    const { trial, skipped } = await this.trial({ name, prompt, repos, paths: checked.paths }, viewer, stats);
    const result: ScoutCheckResult = { ok: true, message: null, ...checked, name, trial };
    this.deps.telemetry.capture('scout_checked', scoutCheckedProps(result, skipped));
    return result;
  }

  /**
   * The dry run, or none without a scouts file or for a scout that would
   * not turn on as written (`scoutFromCard`, Turn on's own check), with why
   * for telemetry; with no calls left today, a trial that says so. A
   * ScoutRun of its own per check: its per-run state (calls left, files
   * read) is never shared with a sync or another check.
   */
  private async trial(scout: ScoutTurnOnRequest, viewer: NonNullable<ReturnType<typeof loadViewer>>, stats: AgentCallStats): Promise<TrialOutcome> {
    if (!this.deps.scoutRunDeps) {
      return { trial: null, skipped: 'no_scouts_file' };
    }
    const asWritten = scoutFromCard(scout);
    if ('error' in asWritten) {
      return { trial: null, skipped: null };
    }
    const config = asWritten.config;
    // The day's allowance bounds the dry run before it reads anything: no listing or file read for calls it can't make.
    const calls = Math.min(SCOUT_TRIAL_JUDGE_CALLS, this.deps.allowance.remaining());
    if (calls === 0) {
      return { trial: { days: SCOUT_TRIAL_DAYS, pulled: 0, examples: [], candidates: 0, judged: 0, complete: false, problem: 'no agent calls left today for a dry run' }, skipped: 'no_calls_left' };
    }
    const budget = new AgentBudget(calls, stats, this.deps.allowance);
    const trial = await new ScoutRun(this.deps.scoutRunDeps).trial(config, SCOUT_TRIAL_DAYS, { viewer, budget, agentOff: this.deps.agentOff(), quotaAllows: this.deps.quotaAllows });
    return { trial, skipped: null };
  }

  /** "Turn on scout": appended to scouts.md, recorded as an `intro` version; the next full sync runs it. The card is answered. */
  turnOn(request: ScoutTurnOnRequest): ActionResult {
    const repos = this.cleanRepos(request.repos);
    if (!this.deps.history) {
      return failed('No scouts file is set up for this PostPile.');
    }
    if (repos === null || request.prompt.trim() === '' || request.name.trim() === '') {
      return failed('A scout needs a name, a prompt and one to five repos.');
    }
    const result = this.deps.history.appendScout({ ...request, repos });
    if ('error' in result) {
      return failed(`Not turned on: ${result.error}`);
    }
    if (result.historyError !== null) {
      this.deps.log(`scouts intro: scout turned on, but its history row was not saved: ${result.historyError}`);
    }
    // The scout is on once scouts.md has it; a config.json that can't be written must not turn that into an error.
    try {
      this.remember();
    } catch (error) {
      this.deps.log(`scouts intro: scout turned on, but the card's answer was not saved: ${errorText(error)}`);
    }
    return ok(`Scout on: ${request.name.trim()}. Finds show under Scouted after the next sync.`);
  }

  /** "Not now": the card never opens by itself again; the Scouted section's "Set up a scout" still opens it. */
  dismiss(): ActionResult {
    try {
      this.remember();
    } catch (error) {
      return failed(`Could not save "Not now": ${errorText(error)}`);
    }
    return ok('Not now. Set up a scout from the Scouted section any time.');
  }
}
