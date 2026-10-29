// The Scouts intro card (DESIGN.md "Scouts" › The intro card): when it opens,
// the repo picker, whether "Check scout" can run, the draft that must never
// overwrite the user's typing, and the words of the check screen.
import { SCOUT_TRIAL_DAYS, trialRateWords, type InboxCleanupView, type InterruptionsView, type ScoutDraftResult, type ScoutFitVerdict, type ScoutIntroState, type ScoutTrial } from '@postpile/core';
import { plural } from './plural.ts';

/** Repos one scout may watch from the card, like the engine's check. */
export const SCOUT_REPOS_MAX = 5;

/**
 * Whether the card waits its turn: while setup shows or its status loads,
 * while the inbox cleanup view loads or its start dialog is due, and while
 * the one-time interruptions question is still open. It never opens on top
 * of another first-run overlay.
 */
export function scoutIntroWaits(input: { setupBlocks: boolean; cleanup: InboxCleanupView | undefined; interruptions: InterruptionsView | undefined }): boolean {
  if (input.setupBlocks || input.cleanup === undefined || input.interruptions === undefined) {
    return true;
  }
  return input.cleanup.start !== null || !input.interruptions.chosen;
}

/**
 * Whether the card is on screen: always after the user asked for it ("Set
 * up a scout"), by itself only when the server says so, nothing else is in
 * the way and it was not closed this session.
 */
export function scoutIntroOpens(input: { state: ScoutIntroState | undefined; waits: boolean; closed: boolean; requested: boolean }): boolean {
  if (input.requested) {
    return true;
  }
  if (input.state === undefined || input.waits || input.closed) {
    return false;
  }
  return input.state.autoShow;
}

/** The picker's first pick: the main repo, or nothing when PostPile has none. */
export function initialRepos(state: ScoutIntroState): string[] {
  return state.mainRepo === null ? [] : [state.mainRepo];
}

/** Known repos not picked yet: what a picked repo's chip can swap to. */
export function unpickedRepos(picked: string[], known: string[]): string[] {
  return known.filter((repo) => !picked.includes(repo));
}

/** Repos "+ repo" offers: the known ones not picked yet; none once five are picked. */
export function addableRepos(picked: string[], known: string[]): string[] {
  if (picked.length >= SCOUT_REPOS_MAX) {
    return [];
  }
  return unpickedRepos(picked, known);
}

/** Why "+ repo" offers nothing, for its `disabled` and `title`; null when it offers repos. */
export function addRepoBlockedReason(picked: string[], known: string[]): string | null {
  if (picked.length >= SCOUT_REPOS_MAX) {
    return `A scout watches at most ${SCOUT_REPOS_MAX} repos`;
  }
  return unpickedRepos(picked, known).length === 0 ? 'No other repos in PostPile yet' : null;
}

export function addRepo(picked: string[], repo: string): string[] {
  if (picked.includes(repo) || picked.length >= SCOUT_REPOS_MAX) {
    return picked;
  }
  return [...picked, repo];
}

export function removeRepo(picked: string[], repo: string): string[] {
  return picked.filter((entry) => entry !== repo);
}

/** A picked repo swapped for another in its place; a repo already picked is left alone. */
export function replaceRepo(picked: string[], from: string, to: string): string[] {
  if (picked.includes(to)) {
    return picked;
  }
  return picked.map((entry) => (entry === from ? to : entry));
}

/** Why "Check scout" cannot run now, for its `disabled` and `title`; null when it can. */
export function checkBlockedReason(input: { prompt: string; repos: string[]; agentOff: string | null }): string | null {
  if (input.agentOff !== null) {
    return input.agentOff;
  }
  if (input.prompt.trim() === '') {
    return 'Say what the scout should look out for first';
  }
  if (input.repos.length === 0) {
    return 'Pick a repo for the scout to watch';
  }
  return null;
}

/**
 * The textarea after the draft came back: the draft only when there is one
 * and the user has not touched the box since the card opened (even typing
 * and clearing it again counts); null leaves the text as it is.
 */
export function textAfterDraft(draft: ScoutDraftResult, typed: boolean): string | null {
  if (draft.why !== 'drafted' || draft.text === null || draft.text.trim() === '' || typed) {
    return null;
  }
  return draft.text;
}

/** The textarea's placeholder: quiet while the draft loads, a short example once it starts empty. */
export function promptPlaceholder(drafting: boolean): string {
  return drafting ? 'Drafting from your instructions…' : 'e.g. New top-level folders or services, and changes to the public API shape';
}

/** "acme/app", "acme/app and acme/web", "acme/app, acme/web and acme/api". */
export function repoListText(repos: string[]): string {
  if (repos.length <= 1) {
    return repos[0] ?? '';
  }
  return `${repos.slice(0, -1).join(', ')} and ${repos[repos.length - 1]}`;
}

/** The footer while the check runs. */
export function checkingText(repos: string[]): string {
  return `Checking… this reads the last ${SCOUT_TRIAL_DAYS} days of ${repoListText(repos)}`;
}

/** Under "Your scout, checked": what was tried, and that nothing is saved. */
export function checkedLead(trial: ScoutTrial | null, repos: string[]): string {
  if (trial === null) {
    return 'PostPile checked what a scout can see in it. Nothing is saved yet.';
  }
  return `PostPile tried it on the last ${trial.days} days of ${repoListText(repos)}. Nothing is saved yet.`;
}

export type FitTone = 'safe' | 'amber' | 'neutral';

/** The fit box's first phrase and look per verdict: green when it fits, amber when partly, grey when not. */
export function fitLook(verdict: ScoutFitVerdict): { lead: string; tone: FitTone } {
  if (verdict === 'fits') {
    return { lead: 'Fits PostPile.', tone: 'safe' };
  }
  if (verdict === 'partly') {
    return { lead: 'Partly fits PostPile.', tone: 'amber' };
  }
  return { lead: 'Not a fit for a scout.', tone: 'neutral' };
}

/** "On the last 2 days: 5 PRs, about 2–3 a day", or that nothing matched. */
export function trialHeading(trial: ScoutTrial): string {
  if (trial.pulled === 0) {
    return `On the last ${trial.days} days: no PRs matched`;
  }
  return `On the last ${trial.days} days: ${plural(trial.pulled, 'PR')}, ${trialRateWords(trial.pulled, trial.days)}`;
}

/** Said plainly when the dry run did not run or stopped short; null for a whole run. */
export function trialNote(trial: ScoutTrial | null): string | null {
  if (trial === null) {
    return 'No dry run this time, so no examples. Turn it on and its finds show under Scouted after the next sync.';
  }
  if (trial.complete) {
    return null;
  }
  const why = trial.problem ?? `judged ${trial.judged} of ${trial.candidates} candidates`;
  return `Only part of it ran: ${why}. The real count may be higher.`;
}

/** An example's PR: "#2701" with one repo picked, the full key with several. */
export function exampleRef(prKey: string, repos: string[]): string {
  if (repos.length > 1) {
    return prKey;
  }
  const hash = prKey.lastIndexOf('#');
  return hash < 0 ? prKey : prKey.slice(hash);
}

/** Why "Turn on scout" cannot run now; null when it can. */
export function turnOnBlockedReason(name: string): string | null {
  return name.trim() === '' ? 'Give the scout a name first' : null;
}
