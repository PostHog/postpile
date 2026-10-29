import { randomUUID } from 'node:crypto';
import {
  cleanScoutLabels,
  emptyAgentCallStats,
  mainRepoOf,
  parsePrKey,
  scoutFromCard,
  scoutIntroAutoShows,
  scoutWantsAfter,
  scoutNameWithId,
  SCOUT_REFINE_MIN_LABELS,
  SCOUT_TRIAL_DAYS,
  SCOUT_TRIAL_JUDGE_CALLS,
  type ActionResult,
  type AgentCallStats,
  type PrKey,
  type ScoutConfig,
  type ScoutCheckRequest,
  type ScoutCheckResult,
  type ScoutDraftResult,
  type ScoutExampleLabel,
  type ScoutIntroState,
  type ScoutRefineRequest,
  type ScoutRefineResult,
  type ScoutTrial,
  type ScoutTurnOnRequest,
  type TelemetryEventProps,
} from '@postpile/core';
import type { AgentService, ScoutRefineExample } from '@postpile/agent';
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
import { ScoutRun, type ScoutRunDeps, type ScoutTrialPr, type ScoutTrialRun } from './scout-run.ts';

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

/** What one version of the scout (prompt and path hints) pulled in its dry run, and the PRs it judged. */
interface TrialRound {
  pulled: Set<PrKey>;
  prs: Map<PrKey, ScoutTrialPr>;
}

/**
 * The card's dry runs while it is open: the runner that keeps the first
 * dry run's listing and reads, and each version's round, so "Tighten"
 * re-runs with judge calls only and Undo can go back to a version the
 * engine still knows. Only the latest check's session is kept.
 */
interface TrialSession {
  id: string;
  repos: string[];
  runner: ScoutRun;
  rounds: Map<string, TrialRound>;
  /** Tightenings run in this session, undone ones too: scout_tightened's round. */
  refines: number;
}

/** A version of the scout as the session knows it: the prompt and hints as Turn on would write them. */
function versionKey(prompt: string, paths: string[]): string {
  return JSON.stringify([prompt.trim(), paths.map((entry) => entry.trim())]);
}

/** The dry run's answer when the day has no agent calls left for it: it read nothing. */
function noCallsTrial(): ScoutTrial {
  return { days: SCOUT_TRIAL_DAYS, pulled: 0, examples: [], nearMisses: [], session: null, candidates: 0, judged: 0, complete: false, problem: 'no agent calls left today for a dry run' };
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
  /** The latest check's dry runs, for "Tighten"; a new check, Turn on or Not now ends it. */
  private session: TrialSession | null = null;

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
   * read) is never shared with a sync or another check. The runner and the
   * round become the card's session, for "Tighten".
   */
  private async trial(scout: ScoutTurnOnRequest, viewer: NonNullable<ReturnType<typeof loadViewer>>, stats: AgentCallStats): Promise<TrialOutcome> {
    if (!this.deps.scoutRunDeps) {
      return { trial: null, skipped: 'no_scouts_file' };
    }
    const asWritten = scoutFromCard(scout);
    if ('error' in asWritten) {
      return { trial: null, skipped: null };
    }
    // The day's allowance bounds the dry run before it reads anything: no listing or file read for calls it can't make.
    const calls = Math.min(SCOUT_TRIAL_JUDGE_CALLS, this.deps.allowance.remaining());
    if (calls === 0) {
      return { trial: noCallsTrial(), skipped: 'no_calls_left' };
    }
    const budget = new AgentBudget(calls, stats, this.deps.allowance);
    const runner = new ScoutRun(this.deps.scoutRunDeps);
    const run = await runner.trial(asWritten.config, SCOUT_TRIAL_DAYS, { viewer, budget, agentOff: this.deps.agentOff(), quotaAllows: this.deps.quotaAllows });
    const session: TrialSession = { id: randomUUID(), repos: scout.repos, runner, rounds: new Map(), refines: 0 };
    session.rounds.set(versionKey(scout.prompt, scout.paths), { pulled: run.pulled, prs: run.prs });
    this.session = session;
    return { trial: { ...run.trial, session: session.id }, skipped: null };
  }

  /**
   * A labeled PR as scout_refine is told about it: as the current version
   * judged it, else as the latest other round did (a Want the current
   * version no longer judges still counts). Null when no round read it.
   */
  private refineExample(session: TrialSession, current: TrialRound, label: ScoutExampleLabel): ScoutRefineExample | null {
    const pr = current.prs.get(label.prKey) ?? [...session.rounds.values()].reverse().find((round) => round.prs.has(label.prKey))?.prs.get(label.prKey);
    if (pr === undefined) {
      return null;
    }
    return { ...pr, pulled: current.pulled.has(label.prKey), label: label.label, why: label.why };
  }

  /**
   * "Tighten": one scout_refine call from the labeled examples, then the
   * dry run again on the same PRs with the first one's listing and reads
   * (judge calls only, at most SCOUT_TRIAL_JUDGE_CALLS), all under the
   * daily allowance. Says which wanted PRs the new version lost. Saves
   * nothing; Turn on writes whichever version the card shows.
   */
  async refine(request: ScoutRefineRequest): Promise<ScoutRefineResult> {
    const stats = emptyAgentCallStats();
    return this.deps.callLog.withRun(`scout-refine:${this.deps.now().toISOString()}`, stats, () => this.refineInRun(request, stats));
  }

  private async refineInRun(request: ScoutRefineRequest, stats: AgentCallStats): Promise<ScoutRefineResult> {
    const refused = (message: string): ScoutRefineResult => ({ ok: false, message, refined: null, trial: null, lostWants: [], uncheckedWants: [] });
    const session = this.session;
    const repos = this.cleanRepos(request.repos);
    if (session === null || session.id !== request.session || repos === null || repos.join(' ') !== session.repos.join(' ')) {
      return refused('This dry run is no longer kept. Check the scout again, then tighten.');
    }
    const before = session.rounds.get(versionKey(request.prompt, request.paths));
    if (before === undefined) {
      return refused('This version has no dry run to tighten from. Check the scout again, then tighten.');
    }
    const off = this.deps.agentOff();
    if (off !== null) {
      return refused(`Agent features are off: ${off}`);
    }
    const viewer = loadViewer(this.deps.store);
    if (viewer === null) {
      return refused('PostPile has not read GitHub yet; check again after the first sync.');
    }
    const labels = cleanScoutLabels(request.labels);
    const examples = labels.map((label) => this.refineExample(session, before, label)).filter((example) => example !== null);
    if (examples.length < SCOUT_REFINE_MIN_LABELS) {
      return refused(`Label at least ${SCOUT_REFINE_MIN_LABELS} examples Want or Noise first.`);
    }
    if (!this.deps.allowance.take()) {
      return refused("Today's agent calls are used up; tighten again tomorrow, or edit the prompt by hand.");
    }
    const name = request.name.trim() === '' ? 'My scout' : request.name.trim();
    const prompt = request.prompt.trim();
    const paths = request.paths.map((entry) => entry.trim());
    let refined;
    try {
      refined = await this.deps.agent.refineScout({ name, prompt, paths, repos, examples, viewer, context: this.deps.contexts.forTopic(null) });
    } catch (error) {
      return refused(`The tightening failed: ${errorText(error)}`);
    }
    // The same read-back as Turn on: a revised prompt that would not turn on as written is not tried either.
    const asWritten = scoutFromCard({ name, prompt: refined.prompt, repos, paths: refined.paths });
    if ('error' in asWritten) {
      return refused(`The tightened scout could not be turned on as written: ${asWritten.error}`);
    }
    session.refines += 1;
    const run = await this.retrial(session, asWritten.config, viewer, stats);
    const trial = run === null ? noCallsTrial() : { ...run.trial, session: session.id };
    if (run !== null) {
      session.rounds.set(versionKey(refined.prompt, refined.paths), { pulled: run.pulled, prs: run.prs });
    }
    // Lost only when the re-run judged it and skipped it; a want it never judged is unknown this round, not lost.
    const wants = scoutWantsAfter(labels, before.pulled, { pulled: run?.pulled ?? new Set(), judged: new Set(run?.prs.keys() ?? []) });
    const titleOf = (prKey: PrKey) => [...session.rounds.values()].find((round) => round.prs.has(prKey))?.prs.get(prKey)?.title ?? prKey;
    const lostWants = wants.lost.map((prKey) => ({ prKey, title: titleOf(prKey), reason: run?.prs.get(prKey)?.reason ?? '' }));
    const uncheckedWants = wants.unchecked.map((prKey) => ({ prKey, title: titleOf(prKey), reason: 'not judged this round' }));
    this.deps.telemetry.capture('scout_tightened', {
      round: session.refines,
      wants: examples.filter((example) => example.label === 'want').length,
      noise: examples.filter((example) => example.label === 'noise').length,
      pulls_before: before.pulled.size,
      pulls_after: trial.pulled,
      lost_wants: lostWants.length,
    });
    return { ok: true, message: null, refined, trial, lostWants, uncheckedWants };
  }

  /** The tightened version's dry run on the session's kept reads; null when the day has no calls left for it. */
  private async retrial(session: TrialSession, config: ScoutConfig, viewer: NonNullable<ReturnType<typeof loadViewer>>, stats: AgentCallStats): Promise<ScoutTrialRun | null> {
    const calls = Math.min(SCOUT_TRIAL_JUDGE_CALLS, this.deps.allowance.remaining());
    if (calls === 0) {
      return null;
    }
    const budget = new AgentBudget(calls, stats, this.deps.allowance);
    return session.runner.retrial(config, { viewer, budget, agentOff: this.deps.agentOff(), quotaAllows: this.deps.quotaAllows });
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
    this.session = null;
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
    this.session = null;
    try {
      this.remember();
    } catch (error) {
      return failed(`Could not save "Not now": ${errorText(error)}`);
    }
    return ok('Not now. Set up a scout from the Scouted section any time.');
  }
}
