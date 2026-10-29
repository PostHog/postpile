// The Scouts intro card on sample data (DESIGN.md "Scouts" › The intro
// card): a canned draft, a canned check with one part a scout can't see and
// a dry run with examples and near misses to label, a canned "Tighten" with
// a second dry run that drops one of the first examples (so the lost-want
// warning can be clicked through), and Turn on adding an empty scout to the
// Scouted section. Invented wording only, no company paths.
import {
  cleanScoutLabels,
  mainRepoOf,
  mapScoutCheck,
  parsePrKey,
  scoutWantsAfter,
  SCOUT_REFINE_MIN_LABELS,
  SCOUT_TRIAL_DAYS,
  type ActionResult,
  type PrKey,
  type ScoutCheckAnswer,
  type ScoutCheckRequest,
  type ScoutCheckResult,
  type ScoutDraftResult,
  type ScoutIntroState,
  type ScoutRefineRequest,
  type ScoutRefineResult,
  type ScoutTrial,
  type ScoutTrialExample,
  type ScoutTurnOnRequest,
} from '@postpile/core';
import type { FakeScouts } from './fake-scouts.ts';

/** The textarea's canned draft. The check quotes one part of it as something a scout can't see. */
export const FAKE_SCOUT_DRAFT =
  'PRs from other teams that change how the app is shaped: a new top-level folder or service, a new facade in front of a module, models shared across module boundaries, or the public API shape (serializers, OpenAPI, generated clients). Skip features and fixes inside one module.';

const CANT_SEE_PART = 'models shared across module boundaries';

const CHECK_ANSWER: ScoutCheckAnswer = {
  fit: 'fits',
  note: 'New folders, facades and API shape all show in titles, descriptions and changed file paths, which is what a scout reads.',
  cantSee: {
    part: CANT_SEE_PART,
    why: 'That usually hides inside the code, and scouts never read diffs. It only catches the ones that say so in the title or description.',
  },
  name: 'Lookout · structure',
  // "+*/" covers only the new folders, not facades or API shape: a partial list would narrow the scout, so none.
  paths: ['+*/'],
  pathsCoverAll: false,
};

/** The one dry run the sample keeps for "Tighten". */
const FAKE_SESSION = 'sample-session';

/** The first dry run's pulls, by PR number: 14 over two days, the first 8 shown. */
const FIRST_PULLS: [number, string, string][] = [
  [2701, 'Add services/ledger as its own top-level service', 'adds services/ledger, a new service next to billing'],
  [2688, 'Billing: expose invoices through a facade', 'new facade under services/billing/api'],
  [2695, 'Move shared test fixtures into tests/common', 'adds tests/common, a new folder'],
  [2712, 'Bump the OpenAPI client generator to 7.4', 'touches the generated API client'],
  [2699, 'Search: public endpoint for saved filters', 'changes the public API shape: a new endpoint'],
  [2706, 'Write down the event bus decision', 'adds docs/architecture/event-bus.md'],
  [2720, 'Add scripts/ for local seeding', 'adds scripts/, a new top-level folder'],
  [2716, 'Notebooks: split the editor into its own module', 'adds a new folder under products/notebooks'],
  [2702, 'Lint config for the new docs site', 'adds docs-site/, a new top-level folder'],
  [2704, 'Rename internal billing helpers', 'renames files under services/billing'],
  [2707, 'Pin the Python base image', 'touches the build setup of every service'],
  [2710, 'Flags: cache reads in the facade', 'changes services/flags/api'],
  [2713, 'Regenerate the API client', 'regenerates the API client'],
  [2719, 'Move e2e helpers', 'adds tests/e2e/helpers, a new folder'],
];

/** PRs with a path match the first dry run skipped. */
const FIRST_NEAR_MISSES: [number, string, string][] = [
  [2703, 'Split the ingestion worker into two services', 'touches services/ingestion, but reads like a refactor inside one service'],
  [2709, 'Feature flags: an internal facade for reads', 'touches services/flags/api, but the description says internal only'],
  [2717, 'Move the session store behind an interface', 'touches services/sessions, but adds no new service or API'],
];

/** The tightened version: skip rules for the noise, narrower hints. */
const REFINED_PROMPT_TAIL = ' Skip PRs that only move tests or fixtures, bump or regenerate API clients, or add local scripts.';
const REFINED_PATHS = ['+*/', 'services/*/public/**', 'openapi/**', 'docs/architecture/**', '+products/*/'];
const REFINED_SUMMARY =
  'Added skip rules for test moves, generated clients and scripts, which you marked as noise, and narrowed services/** to the public API folders.';
/** What the tightened version pulls on the same PRs: the facade (#2688) no longer matches a hint, the split (#2703) now does. */
const SECOND_PULLS: [number, string, string][] = [
  [2701, 'Add services/ledger as its own top-level service', 'adds services/ledger, a new service next to billing'],
  [2699, 'Search: public endpoint for saved filters', 'changes services/search/public, the public API shape'],
  [2706, 'Write down the event bus decision', 'adds docs/architecture/event-bus.md'],
  [2703, 'Split the ingestion worker into two services', 'adds services/ingestion-replay as a second service'],
];
const SECOND_NEAR_MISSES: [number, string, string][] = [
  [2716, 'Notebooks: split the editor into its own module', 'adds products/notebooks/editor, but only moves code inside one product'],
];

function examplesOf(repo: string, rows: [number, string, string][]): ScoutTrialExample[] {
  return rows.map(([number, title, reason]) => ({ prKey: `${repo}#${number}`, title, reason }));
}

function cannedTrial(repo: string, pulls: [number, string, string][], nearMisses: [number, string, string][]): ScoutTrial {
  return { days: SCOUT_TRIAL_DAYS, pulled: pulls.length, examples: examplesOf(repo, pulls).slice(0, 8), nearMisses: examplesOf(repo, nearMisses), session: FAKE_SESSION, candidates: 31, judged: 31, complete: true, problem: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The card's state and answers on sample data. It opens by itself until
 * "Not now" or "Turn on scout" (the sample already has scouts, so the
 * engine's "no scout yet" rule would never show it here).
 */
export class FakeScoutIntro {
  private answered = false;

  constructor(
    private readonly scouts: FakeScouts,
    private readonly prKeys: () => PrKey[],
    /** Base delay of the draft and the check, so the loading states show. Tests pass 0. */
    private readonly delayMs: number,
  ) {}

  /** Repos of the sample's PRs, most PRs first. */
  private repos(): string[] {
    const counts = new Map<string, number>();
    for (const key of this.prKeys()) {
      const repo = parsePrKey(key).repo;
      counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([repo]) => repo);
  }

  state(): ScoutIntroState {
    return { autoShow: !this.answered, mainRepo: mainRepoOf(this.prKeys()), repos: this.repos(), scouts: this.scouts.list().length };
  }

  async draft(): Promise<ScoutDraftResult> {
    await delay(this.delayMs);
    return { text: FAKE_SCOUT_DRAFT, why: 'drafted' };
  }

  /** The canned answer mapped onto the prompt like the engine's, so a dropped part does not come back. */
  async check(request: ScoutCheckRequest): Promise<ScoutCheckResult> {
    const prompt = request.prompt.trim();
    const repo = request.repos[0];
    if (prompt === '' || repo === undefined) {
      return { ok: false, message: 'Pick one to five repos (owner/name) and say what to look out for.', fit: { verdict: 'partly', note: '' }, cantSee: null, name: '', paths: [], trial: null };
    }
    await delay(this.delayMs * 3);
    return { ok: true, message: null, ...mapScoutCheck(CHECK_ANSWER, prompt), trial: cannedTrial(repo, FIRST_PULLS, FIRST_NEAR_MISSES) };
  }

  /**
   * "Tighten" on sample data: the canned skip rules and hints, and the
   * second dry run. From the tightened version it stays where it is. Lost
   * wants are worked out like the engine's, from the labels.
   */
  async refine(request: ScoutRefineRequest): Promise<ScoutRefineResult> {
    const repo = request.repos[0];
    const labels = cleanScoutLabels(request.labels);
    if (request.session !== FAKE_SESSION || repo === undefined) {
      return { ok: false, message: 'This dry run is no longer kept. Check the scout again, then tighten.', refined: null, trial: null, lostWants: [], uncheckedWants: [] };
    }
    if (labels.length < SCOUT_REFINE_MIN_LABELS) {
      return { ok: false, message: `Label at least ${SCOUT_REFINE_MIN_LABELS} examples Want or Noise first.`, refined: null, trial: null, lostWants: [], uncheckedWants: [] };
    }
    await delay(this.delayMs * 3);
    const prompt = request.prompt.trim();
    const alreadyTight = prompt.endsWith(REFINED_PROMPT_TAIL.trim());
    const before = new Set(examplesOf(repo, alreadyTight ? SECOND_PULLS : FIRST_PULLS).map((example) => example.prKey));
    const after = examplesOf(repo, SECOND_PULLS);
    // The sample's second dry run judges every PR the first one did, so no want goes unchecked.
    const judged = new Set([...examplesOf(repo, FIRST_PULLS), ...examplesOf(repo, FIRST_NEAR_MISSES)].map((example) => example.prKey));
    const lost = new Set(scoutWantsAfter(labels, before, { pulled: new Set(after.map((example) => example.prKey)), judged }).lost);
    const lostWants = examplesOf(repo, FIRST_PULLS)
      .filter((example) => lost.has(example.prKey))
      .map((example) => ({ ...example, reason: 'no path signal: no hint matches its files any more' }));
    const refined = alreadyTight
      ? { prompt, paths: REFINED_PATHS, summary: 'Your labels give no new pattern, so the prompt and path hints stay as they are.', droppedHints: 0 }
      : { prompt: `${prompt}${REFINED_PROMPT_TAIL}`, paths: REFINED_PATHS, summary: REFINED_SUMMARY, droppedHints: 0 };
    return { ok: true, message: null, refined, trial: cannedTrial(repo, SECOND_PULLS, SECOND_NEAR_MISSES), lostWants, uncheckedWants: [] };
  }

  /** Adds the scout to the Scouted section with nothing pulled in yet; same words as the engine. */
  turnOn(request: ScoutTurnOnRequest): ActionResult {
    const name = request.name.trim();
    if (name === '' || request.prompt.trim() === '' || request.repos.length === 0) {
      return { ok: false, message: 'A scout needs a name, a prompt and one to five repos.', undoToken: null };
    }
    this.scouts.addScout(name);
    this.answered = true;
    return { ok: true, message: `Scout on: ${name}. Finds show under Scouted after the next sync.`, undoToken: null };
  }

  dismiss(): ActionResult {
    this.answered = true;
    return { ok: true, message: 'Not now. Set up a scout from the Scouted section any time.', undoToken: null };
  }
}
