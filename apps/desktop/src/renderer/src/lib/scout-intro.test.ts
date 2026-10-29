import { describe, expect, it } from 'vitest';
import type { InboxCleanupView, InterruptionsView, ScoutIntroState, ScoutTrial } from '@postpile/core';
import {
  addableRepos,
  addRepo,
  addRepoBlockedReason,
  checkBlockedReason,
  checkedLead,
  exampleRef,
  fitLook,
  initialRepos,
  removeRepo,
  replaceRepo,
  repoListText,
  scoutIntroLoadRetries,
  scoutIntroOpens,
  scoutIntroWaits,
  SCOUT_REPOS_MAX,
  textAfterDraft,
  trialHeading,
  trialNote,
  trialSkipped,
  turnOnBlockedReason,
  unpickedRepos,
} from './scout-intro.ts';

const STATE: ScoutIntroState = { autoShow: true, mainRepo: 'acme/app', repos: ['acme/app', 'acme/web', 'acme/api'], scouts: 0 };
const IDLE = { start: null, running: null } as InboxCleanupView;
const CHOSEN = { mode: 'never', chosen: true, roundupTimes: [] } as unknown as InterruptionsView;
const TRIAL: ScoutTrial = { days: 2, pulled: 5, examples: [], candidates: 9, judged: 9, complete: true, problem: null };

describe('scoutIntroWaits', () => {
  it('lets the card through once setup, the start dialog and the interruptions question are out of the way', () => {
    expect(scoutIntroWaits({ setupBlocks: false, cleanup: IDLE, interruptions: CHOSEN })).toBe(false);
  });

  it('waits behind setup, while views load, for the start dialog and for an unanswered interruptions question', () => {
    expect(scoutIntroWaits({ setupBlocks: true, cleanup: IDLE, interruptions: CHOSEN })).toBe(true);
    expect(scoutIntroWaits({ setupBlocks: false, cleanup: undefined, interruptions: CHOSEN })).toBe(true);
    expect(scoutIntroWaits({ setupBlocks: false, cleanup: IDLE, interruptions: undefined })).toBe(true);
    expect(scoutIntroWaits({ setupBlocks: false, cleanup: { ...IDLE, start: { kind: 'weekend', since: '2026-10-03T09:00:00.000Z' } }, interruptions: CHOSEN })).toBe(true);
    expect(scoutIntroWaits({ setupBlocks: false, cleanup: IDLE, interruptions: { ...CHOSEN, chosen: false } })).toBe(true);
  });
});

describe('scoutIntroOpens', () => {
  it('opens by itself only when the server says so, nothing waits and it was not closed', () => {
    expect(scoutIntroOpens({ state: STATE, waits: false, closed: false, requested: false })).toBe(true);
    expect(scoutIntroOpens({ state: { ...STATE, autoShow: false }, waits: false, closed: false, requested: false })).toBe(false);
    expect(scoutIntroOpens({ state: STATE, waits: true, closed: false, requested: false })).toBe(false);
    expect(scoutIntroOpens({ state: STATE, waits: false, closed: true, requested: false })).toBe(false);
    expect(scoutIntroOpens({ state: undefined, waits: false, closed: false, requested: false })).toBe(false);
  });

  it('always opens when the user asked for it', () => {
    expect(scoutIntroOpens({ state: { ...STATE, autoShow: false }, waits: true, closed: true, requested: true })).toBe(true);
  });
});

describe('repo picker', () => {
  it('starts on the main repo, or empty without one', () => {
    expect(initialRepos(STATE)).toEqual(['acme/app']);
    expect(initialRepos({ ...STATE, mainRepo: null })).toEqual([]);
  });

  it('offers the repos not picked yet, none once five are picked, and says why', () => {
    expect(addableRepos(['acme/app'], STATE.repos)).toEqual(['acme/web', 'acme/api']);
    expect(addRepoBlockedReason(['acme/app'], STATE.repos)).toBeNull();
    const five = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'];
    expect(five).toHaveLength(SCOUT_REPOS_MAX);
    expect(addableRepos(five, [...five, 'a/6'])).toEqual([]);
    expect(addRepoBlockedReason(five, [...five, 'a/6'])).toMatch(/at most 5/);
    expect(addRepoBlockedReason(['acme/app'], ['acme/app'])).not.toBeNull();
  });

  it('lets a picked repo swap to any repo not picked, also with five picked', () => {
    const five = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'];
    expect(unpickedRepos(five, [...five, 'a/6'])).toEqual(['a/6']);
  });

  it('adds without duplicates or a sixth, removes and swaps in place', () => {
    expect(addRepo(['acme/app'], 'acme/web')).toEqual(['acme/app', 'acme/web']);
    expect(addRepo(['acme/app'], 'acme/app')).toEqual(['acme/app']);
    expect(addRepo(['a/1', 'a/2', 'a/3', 'a/4', 'a/5'], 'a/6')).toHaveLength(5);
    expect(removeRepo(['acme/app', 'acme/web'], 'acme/app')).toEqual(['acme/web']);
    expect(replaceRepo(['acme/app', 'acme/web'], 'acme/app', 'acme/api')).toEqual(['acme/api', 'acme/web']);
    expect(replaceRepo(['acme/app', 'acme/web'], 'acme/app', 'acme/web')).toEqual(['acme/app', 'acme/web']);
  });
});

describe('checkBlockedReason', () => {
  it('lets the check run with a prompt and a repo', () => {
    expect(checkBlockedReason({ prompt: 'new folders', repos: ['acme/app'], agentOff: null })).toBeNull();
  });

  it('says why not: agent off first, then an empty prompt, then no repo', () => {
    expect(checkBlockedReason({ prompt: 'new folders', repos: ['acme/app'], agentOff: 'Agent paused' })).toBe('Agent paused');
    expect(checkBlockedReason({ prompt: '  ', repos: [], agentOff: null })).toMatch(/look out for/);
    expect(checkBlockedReason({ prompt: 'new folders', repos: [], agentOff: null })).toMatch(/repo/);
  });
});

describe('textAfterDraft', () => {
  const drafted = { text: 'New top-level folders', why: 'drafted' } as const;

  it('fills an untouched box with the draft', () => {
    expect(textAfterDraft(drafted, false)).toBe('New top-level folders');
  });

  it('never overwrites what the user typed, even after they cleared it again', () => {
    expect(textAfterDraft(drafted, true)).toBeNull();
  });

  it('leaves the box alone without a draft', () => {
    expect(textAfterDraft({ text: null, why: 'agent_off' }, false)).toBeNull();
    expect(textAfterDraft({ text: null, why: 'capped' }, false)).toBeNull();
    expect(textAfterDraft({ text: null, why: 'failed' }, false)).toBeNull();
  });
});

describe('check screen', () => {
  it('lists repos in running text', () => {
    expect(repoListText(['acme/app'])).toBe('acme/app');
    expect(repoListText(['acme/app', 'acme/web'])).toBe('acme/app and acme/web');
    expect(repoListText(['acme/app', 'acme/web', 'acme/api'])).toBe('acme/app, acme/web and acme/api');
  });

  it('picks the fit look per verdict', () => {
    expect(fitLook('fits').tone).toBe('safe');
    expect(fitLook('partly').tone).toBe('amber');
    expect(fitLook('no').tone).toBe('neutral');
  });

  it('heads the dry run with the count and the rate, or says nothing matched', () => {
    expect(trialHeading(TRIAL)).toBe('On the last 2 days: 5 PRs, about 2–3 a day');
    expect(trialHeading({ ...TRIAL, pulled: 1 })).toBe('On the last 2 days: 1 PR, fewer than 1 a day');
    expect(trialHeading({ ...TRIAL, pulled: 0 })).toBe('On the last 2 days: no PRs matched');
  });

  it('notes a missing or partial dry run, nothing for a whole one', () => {
    expect(trialNote(TRIAL)).toBeNull();
    expect(trialNote(null)).not.toBeNull();
    expect(trialNote({ ...TRIAL, complete: false, problem: 'the call cap ran out' })).toContain('the call cap ran out');
    expect(trialNote({ ...TRIAL, complete: false, judged: 5 })).toContain('judged 5 of 9 candidates');
    // Nothing tried at all: says why, never "no PRs matched".
    const skipped = { ...TRIAL, pulled: 0, examples: [], candidates: 0, judged: 0, complete: false, problem: 'no agent calls left today for a dry run' };
    expect(trialSkipped(skipped)).toBe(true);
    expect(trialNote(skipped)).toBe('No dry run: no agent calls left today for a dry run. Turn it on and its finds show under Scouted after the next sync.');
    expect(checkedLead(skipped, ['acme/app'])).toBe('PostPile checked what a scout can see in it. Nothing is saved yet.');
  });

  it('shows an example as #number with one repo, the full key with several', () => {
    expect(exampleRef('acme/app#2701', ['acme/app'])).toBe('#2701');
    expect(exampleRef('acme/app#2701', ['acme/app', 'acme/web'])).toBe('acme/app#2701');
  });

  it('needs a name to turn on', () => {
    expect(turnOnBlockedReason('Lookout')).toBeNull();
    expect(turnOnBlockedReason(' ')).not.toBeNull();
  });
});

describe('scoutIntroLoadRetries', () => {
  it('asks again once per Set up a scout click while the state failed to load', () => {
    expect(scoutIntroLoadRetries({ requested: true, failed: true, retried: false })).toBe(true);
    expect(scoutIntroLoadRetries({ requested: true, failed: true, retried: true })).toBe(false);
    expect(scoutIntroLoadRetries({ requested: false, failed: true, retried: false })).toBe(false);
    expect(scoutIntroLoadRetries({ requested: true, failed: false, retried: false })).toBe(false);
  });
});
