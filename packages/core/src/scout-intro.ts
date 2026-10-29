// The Scouts intro card (DESIGN.md "Scouts" › The intro card): when it shows
// by itself, what the check of a drafted scout found, and how a scout the
// user turns on is written into scouts.md. Rules only, no IO.
import { clipText } from './dossier.ts';
import { parsePathHint, parseScouts } from './scouts-config.ts';
import type { IsoTime, PrKey } from './types.ts';

/** The dry run of "Check scout" looks this far back. */
export const SCOUT_TRIAL_DAYS = 2;
/** scout_judge calls the dry run may spend at most. */
export const SCOUT_TRIAL_JUDGE_CALLS = 5;
/** Example pulls the check shows. */
export const SCOUT_TRIAL_EXAMPLES = 2;
/** Path hints a check may suggest. */
export const SCOUT_CHECK_PATHS = 6;
const NAME_MAX = 60;
const NOTE_MAX = 300;

/** What the card needs before it opens: whether it opens by itself, and the repos for the picker. */
export interface ScoutIntroState {
  /** Open the card by itself: never dismissed, and no scout in scouts.md. */
  autoShow: boolean;
  /** The picker's default: the repo the user works in most (setup's pick, else the board's). Null with no PRs. */
  mainRepo: string | null;
  /** Repos PostPile knows, for "+ repo". */
  repos: string[];
  /** Scouts in force now. */
  scouts: number;
}

/**
 * The card opens by itself once there is no scout to show and the user
 * never said "Not now" (nor turned a scout on from it). Quitting with the
 * card open shows it again on the next start: it was never answered.
 */
export function scoutIntroAutoShows(input: { dismissedAt: IsoTime | null; scouts: number }): boolean {
  return input.dismissedAt === null && input.scouts === 0;
}

/** The textarea's first text: drafted by the agent, or why it starts empty. */
export interface ScoutDraftResult {
  text: string | null;
  why: 'drafted' | 'agent_off' | 'capped' | 'failed';
}

export interface ScoutCheckRequest {
  prompt: string;
  /** owner/name each, at least one. */
  repos: string[];
}

export type ScoutFitVerdict = 'fits' | 'partly' | 'no';

/** A part of the prompt a scout cannot see (it reads titles, descriptions and changed paths, never diffs). */
export interface ScoutCantSee {
  /** Quoted from the prompt as the user wrote it. */
  part: string;
  why: string;
  /** The prompt with that part dropped: what "Drop that part" puts in the textarea. */
  rewrite: string;
}

export interface ScoutTrialExample {
  prKey: PrKey;
  title: string;
  reason: string;
}

/** "Check scout"'s dry run on the last days of the chosen repos: nothing is saved, no cursor moves. */
export interface ScoutTrial {
  days: number;
  /** PRs the scout would have pulled. */
  pulled: number;
  examples: ScoutTrialExample[];
  /** Candidates after the rules, and how many of them the model saw within its call cap. */
  candidates: number;
  judged: number;
  /** Every candidate was judged and every repo listed whole. */
  complete: boolean;
  /** Why the run stopped short, in a few words; null when it did not. */
  problem: string | null;
}

export interface ScoutCheckResult {
  ok: boolean;
  /** Why the check could not run (agent off, capped); null when it ran. */
  message: string | null;
  fit: { verdict: ScoutFitVerdict; note: string };
  cantSee: ScoutCantSee | null;
  /** The suggested name for the name field. */
  name: string;
  /** Path hints the scout gets; not shown on the card, edited in scouts.md. */
  paths: string[];
  trial: ScoutTrial | null;
}

/** The agent's check answer after zod, before anything is checked against the prompt. */
export interface ScoutCheckAnswer {
  fit: string;
  note: string;
  cantSee: { part: string; why: string; rewrite: string } | null;
  name: string;
  paths: string[];
}

/** Folds whitespace for comparing a quote with the prompt. */
function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The check answer onto the user's prompt, like the setup fit check: a
 * "can't see" part stays only when it quotes the prompt and its rewrite is
 * a real, shorter prompt; path hints only when they parse (no commas, no
 * "!", "[ ]" or "\"), at most SCOUT_CHECK_PATHS. An unknown verdict reads
 * as partly, the cautious middle.
 */
export function mapScoutCheck(answer: ScoutCheckAnswer, prompt: string): Pick<ScoutCheckResult, 'fit' | 'cantSee' | 'name' | 'paths'> {
  const verdicts: ScoutFitVerdict[] = ['fits', 'partly', 'no'];
  const verdict = verdicts.find((entry) => entry === answer.fit.trim().toLowerCase()) ?? 'partly';
  const raw = answer.cantSee;
  const quotes = raw !== null && raw.part.trim() !== '' && folded(prompt).includes(folded(raw.part));
  const rewrite = raw?.rewrite.trim() ?? '';
  const cantSee = raw !== null && quotes && rewrite !== '' && rewrite.length < prompt.trim().length ? { part: raw.part.trim(), why: clipText(raw.why, NOTE_MAX), rewrite } : null;
  const paths = answer.paths
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !entry.includes(',') && typeof parsePathHint(entry) !== 'string')
    .slice(0, SCOUT_CHECK_PATHS);
  const name = clipText(answer.name.replace(/\s+/g, ' ').trim(), NAME_MAX) || 'My scout';
  return { fit: { verdict, note: clipText(answer.note, NOTE_MAX) }, cantSee, name, paths };
}

/** "about 2–3 a day", "about 1 a day", "fewer than 1 a day", "none": how many pulls a day the dry run suggests. */
export function trialRateWords(pulled: number, days: number): string {
  if (pulled === 0) {
    return 'none';
  }
  const rate = pulled / days;
  if (rate < 1) {
    return 'fewer than 1 a day';
  }
  const low = Math.floor(rate);
  const high = Math.ceil(rate);
  return low === high ? `about ${low} a day` : `about ${low}–${high} a day`;
}

export interface ScoutTurnOnRequest {
  name: string;
  prompt: string;
  repos: string[];
  paths: string[];
}

/** One scout's section of scouts.md, as the parser reads it back. */
export function scoutSection(scout: ScoutTurnOnRequest): string {
  const lines = [`## ${scout.name.replace(/\s+/g, ' ').trim()}`, `repos: ${scout.repos.join(', ')}`];
  if (scout.paths.length > 0) {
    lines.push(`paths: ${scout.paths.join(', ')}`);
  }
  return `${lines.join('\n')}\n\n${scout.prompt.trim()}\n`;
}

/**
 * scouts.md with the scout appended, or why it cannot be: the file must
 * parse before and after, and the new scout must read back exactly as
 * asked (a prompt line that looks like a heading or a key line would not).
 */
export function appendScout(text: string, scout: ScoutTurnOnRequest): { text: string } | { error: string } {
  const before = parseScouts(text);
  if (before.errors.length > 0) {
    return { error: `scouts.md does not parse (${before.errors[0]}); fix it first` };
  }
  const separator = text.trim() === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const next = `${text.trim() === '' ? '' : text}${separator}${scoutSection(scout)}`;
  const after = parseScouts(next);
  if (after.errors.length > 0) {
    return { error: after.errors[0]! };
  }
  const added = after.scouts[after.scouts.length - 1];
  if (after.scouts.length !== before.scouts.length + 1 || !added || added.prompt !== scout.prompt.trim() || added.repos.join(',') !== scout.repos.join(',')) {
    return { error: 'the prompt would not read back as written; remove lines starting with "##" or "repos:"' };
  }
  return { text: next };
}
