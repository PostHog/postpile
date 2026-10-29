// The Scouts intro card on sample data (DESIGN.md "Scouts" › The intro
// card): a canned draft, a canned check with one part a scout can't see and
// a small dry run, and Turn on adding an empty scout to the Scouted section.
// Invented wording only, no company paths.
import {
  mainRepoOf,
  mapScoutCheck,
  parsePrKey,
  SCOUT_TRIAL_DAYS,
  type ActionResult,
  type PrKey,
  type ScoutCheckAnswer,
  type ScoutCheckRequest,
  type ScoutCheckResult,
  type ScoutDraftResult,
  type ScoutIntroState,
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
    const examples = [
      { prKey: `${repo}#2701`, title: 'Add services/ledger as its own top-level service', reason: 'adds services/, a new top-level folder' },
      { prKey: `${repo}#2688`, title: 'Billing: expose invoices through a facade', reason: 'new facade under services/billing/api' },
    ];
    const trial = { days: SCOUT_TRIAL_DAYS, pulled: 5, examples, candidates: 9, judged: 9, complete: true, problem: null };
    return { ok: true, message: null, ...mapScoutCheck(CHECK_ANSWER, prompt), trial };
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
