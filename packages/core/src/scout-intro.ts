// The Scouts intro card (DESIGN.md "Scouts" › The intro card): when it shows
// by itself, what the check of a drafted scout found, and how a scout the
// user turns on is written into scouts.md. Rules only, no IO.
import { clipText } from './dossier.ts';
import { parsePathHint, parseScouts, scoutSlug, type ScoutConfig } from './scouts-config.ts';
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
/** Longest scout name Turn on takes (the route's limit). */
export const SCOUT_NAME_MAX = 80;
const NOTE_MAX = 300;
/** Longest path hint the card passes on; the turn-on route takes no longer. */
export const SCOUT_PATH_HINT_MAX = 200;
/** Most `*` a hint may hold ("services/**\/api/*.ts" has four): matching is linear anyway, this keeps hints plain. */
const SCOUT_PATH_HINT_STARS = 8;
/** What a path glob is made of: no spaces, line breaks, commas or notes. */
const PATH_GLOB = /^\+?[A-Za-z0-9_.*?/@~-]+$/;

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
  /**
   * The prompt with that part cut out (`promptWithoutPart`): what "Drop
   * that part" puts in the textarea. Null when the part is not in the
   * prompt word for word: the card then offers only "Keep it anyway".
   */
  rewrite: string | null;
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
  cantSee: { part: string; why: string } | null;
  name: string;
  paths: string[];
  /** The check's own word that the paths cover every kind of PR the prompt asks for. */
  pathsCoverAll: boolean;
}

/** Folds whitespace for comparing a quote with the prompt. */
function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A path hint scouts.md can hold as one list item: a glob of path
 * characters with an optional leading "+", at most SCOUT_PATH_HINT_MAX
 * long, that parses. No line break, comma or space, so it can never end
 * its line or start a key of its own.
 */
export function isScoutPathHint(entry: string): boolean {
  const stars = entry.split('*').length - 1;
  // The globstar cap is scouts.md's own (`SCOUT_HINT_GLOBSTARS`, in `parsePathHint`): one rule for both.
  return entry.length <= SCOUT_PATH_HINT_MAX && stars <= SCOUT_PATH_HINT_STARS && PATH_GLOB.test(entry) && typeof parsePathHint(entry) !== 'string';
}

/**
 * The prompt with `part` cut out where it appears word for word, the
 * punctuation around the cut tidied: "A, B, or C." without "B" reads
 * "A, or C.". Null when the part is not in the prompt as written, or
 * nothing would be left.
 */
export function promptWithoutPart(prompt: string, part: string): string | null {
  const quote = part.trim();
  const at = quote === '' ? -1 : prompt.indexOf(quote);
  if (at < 0) {
    return null;
  }
  const rest = (prompt.slice(0, at) + prompt.slice(at + quote.length))
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?)])/g, '$1')
    .replace(/[,;:]+(\s*[,;:.!?])/g, '$1')
    .replace(/^[\s,;:.]+/, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
  if (rest === '' || !/[A-Za-z0-9]/.test(rest)) {
    return null;
  }
  // Cut from the start: the sentence that is left starts with a capital again.
  return at === 0 ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
}

/**
 * The check answer onto the user's prompt, like the setup fit check: a
 * "can't see" part stays only when it quotes the prompt, and dropping it
 * cuts exactly that part (`promptWithoutPart`), never a model rewrite;
 * path hints only when the check says they cover the whole prompt
 * (`pathsCoverAll`) and each `isScoutPathHint`, at most SCOUT_CHECK_PATHS:
 * paths are a hard filter, so a partial list would narrow the scout, while
 * no list only costs judge calls. When unsure, none. An unknown verdict
 * reads as partly, the cautious middle.
 */
export function mapScoutCheck(answer: ScoutCheckAnswer, prompt: string): Pick<ScoutCheckResult, 'fit' | 'cantSee' | 'name' | 'paths'> {
  const verdicts: ScoutFitVerdict[] = ['fits', 'partly', 'no'];
  const verdict = verdicts.find((entry) => entry === answer.fit.trim().toLowerCase()) ?? 'partly';
  const raw = answer.cantSee;
  const quotes = raw !== null && raw.part.trim() !== '' && folded(prompt).includes(folded(raw.part));
  const cantSee = raw !== null && quotes ? { part: raw.part.trim(), why: clipText(raw.why, NOTE_MAX), rewrite: promptWithoutPart(prompt.trim(), raw.part) } : null;
  const hints = answer.paths.map((entry) => entry.trim());
  // One hint dropped as unusable leaves the rest partial: all of them go, like a check that is unsure.
  const usable = answer.pathsCoverAll && hints.length <= SCOUT_CHECK_PATHS && hints.every(isScoutPathHint);
  const paths = usable ? hints : [];
  const name = clipText(answer.name.replace(/\s+/g, ' ').trim(), NAME_MAX) || 'My scout';
  return { fit: { verdict, note: clipText(answer.note, NOTE_MAX) }, cantSee, name, paths };
}

/**
 * A name the card can turn on as is: its slug is the scout's id, so a name
 * with no letters or digits it can slug (all CJK, say) falls back to
 * "Scout <repo>", and a name whose id another scout has gets " 2", " 3",
 * all within SCOUT_NAME_MAX.
 */
export function scoutNameWithId(name: string, repos: string[], takenIds: ReadonlySet<string>): string {
  const repoName = repos[0]?.split('/')[1] ?? '';
  const base = scoutSlug(name) !== '' ? name : `Scout ${repoName}`.trim();
  // Within Turn on's limit, the " 2" suffix included: a long repo name is cut, never the suffix.
  const within = (suffix: string) => `${base.slice(0, SCOUT_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  let candidate = within('');
  for (let n = 2; takenIds.has(scoutSlug(candidate)); n++) {
    candidate = within(` ${n}`);
  }
  return candidate;
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

/**
 * One scout's section of scouts.md, as the parser reads it back. Only
 * hints that pass `isScoutPathHint` are written: a hint can never break
 * its line and add a key line (an `id:` taking another scout's history).
 */
export function scoutSection(scout: ScoutTurnOnRequest): string {
  const lines = [`## ${scout.name.replace(/\s+/g, ' ').trim()}`, `repos: ${scout.repos.join(', ')}`];
  const paths = scout.paths.map((entry) => entry.trim()).filter(isScoutPathHint);
  if (paths.length > 0) {
    lines.push(`paths: ${paths.join(', ')}`);
  }
  return `${lines.join('\n')}\n\n${scout.prompt.trim()}\n`;
}

/**
 * scouts.md with the scout appended, or why it cannot be: the file must
 * parse before and after, and the new scout must read back exactly as
 * asked (a prompt line that looks like a heading or a key line would not).
 */
export function appendScout(text: string, scout: ScoutTurnOnRequest): { text: string } | { error: string } {
  const badHint = scout.paths.find((entry) => !isScoutPathHint(entry.trim()));
  if (badHint !== undefined) {
    return { error: `"${clipText(badHint.replace(/\s+/g, ' '), 60)}" is not a path hint scouts.md can hold` };
  }
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
  const readsBack =
    added !== undefined &&
    added.id === scoutSlug(added.name) &&
    added.prompt === scout.prompt.trim() &&
    added.repos.join(',') === scout.repos.join(',') &&
    added.paths.map((hint) => `${hint.addedOnly ? '+' : ''}${hint.pattern}`).join(',') === scout.paths.map((entry) => entry.trim()).join(',');
  if (after.scouts.length !== before.scouts.length + 1 || !readsBack) {
    return { error: 'the prompt would not read back as written; remove lines starting with "##" or "repos:"' };
  }
  return { text: next };
}

/**
 * The scout as the card would turn it on, through the same check as
 * activation (`appendScout`'s write and read-back): the check's dry run
 * runs on exactly this, so a prompt line such as "repos: …" can never widen
 * what the dry run reads.
 */
export function scoutFromCard(scout: ScoutTurnOnRequest): { config: ScoutConfig } | { error: string } {
  const result = appendScout('', scout);
  if ('error' in result) {
    return result;
  }
  return { config: parseScouts(result.text).scouts[0]! };
}
