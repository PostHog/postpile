// The setup flow (DESIGN.md "Setup flow"): an agent helps a new user write
// their instructions.md from their recent GitHub activity, CODEOWNERS and
// the work context digest. The user reviews and accepts; nothing is written
// before that. These are the wire types; the rules live in setup-draft.ts.

import type { TeamRolesView } from './team-roles.ts';
import type { IsoTime, PrKey, PrState, Viewer } from './types.ts';
import type { ActionResult } from './views.ts';

export type SetupCheckId = 'gh' | 'gh_auth' | 'notifications' | 'claude';

/** ok: works. warn: works without it, with less. fail: fix it first. skipped: an earlier check failed. */
export type SetupCheckState = 'ok' | 'warn' | 'fail' | 'skipped';

export interface SetupCheck {
  id: SetupCheckId;
  label: string;
  state: SetupCheckState;
  /** "gh version 2.60.0", "Logged in as alice", or what went wrong. */
  detail: string;
  /** The exact command that fixes it. Null when there is nothing to run. */
  fix: string | null;
}

export interface SetupChecksView {
  checks: SetupCheck[];
  /** The GitHub login gh is logged in as, when it answered. */
  login: string | null;
  /** gh is installed, logged in and can read notifications. The flow only continues then. */
  canContinue: boolean;
  /** The claude CLI was found. Without it there is no agent draft (and no agent features at all). */
  agentAvailable: boolean;
}

/** done: accepted once. skipped: "Skip for now"; the Instructions pane offers it again. */
export type SetupFlag = 'done' | 'skipped';

export interface SetupStatus {
  /** Show the flow instead of topics: no instructions yet and no flag. Sample data can force it. */
  needed: boolean;
  flag: SetupFlag | null;
  flaggedAt: IsoTime | null;
  hasInstructions: boolean;
}

/** How the user touched a PR in the sweep window. */
export type ActivityRole = 'authored' | 'reviewed' | 'review_requested';

/** One PR from the setup sweep's activity search. Titles and folders only, never bodies or comments. */
export interface ActivityPr {
  key: PrKey;
  repo: string;
  number: number;
  title: string;
  url: string;
  role: ActivityRole;
  state: PrState;
  updatedAt: IsoTime;
  /** Top-level folders the PR changes, most files first ("frontend/", "posthog/"); "(root)" for files at the top. */
  dirs: string[];
}

/** CODEOWNERS lines of one repo that name the user or one of their teams. */
export interface CodeownersExcerpt {
  repo: string;
  /** Where the file was found: ".github/CODEOWNERS", "CODEOWNERS" or "docs/CODEOWNERS". */
  path: string;
  lines: string[];
}

/** Everything the sweep gathered, the input for the draft. */
export interface SetupMaterial {
  viewer: Viewer;
  since: IsoTime;
  prs: ActivityPr[];
  codeowners: CodeownersExcerpt[];
  /** The newest work context digest as prompt text, when one exists. */
  digest: { version: number; createdAt: IsoTime; text: string } | null;
}

export type SetupSourceKind = 'team' | 'pr' | 'codeowners' | 'digest';

/** Something a draft claim can cite: "t1" (a team), "p3" (a PR), "o2" (CODEOWNERS), "d1" (the digest). */
export interface SetupSource {
  id: string;
  kind: SetupSourceKind;
  /** "acme/app#12", "acme/app CODEOWNERS", "Work context v3", "Team acme/devex". */
  label: string;
  /** The PR title and role, the CODEOWNERS lines, the digest's first lines, the team's members. */
  detail: string;
  url: string | null;
}

/** One line of the draft and what it rests on. */
export interface SetupClaim {
  text: string;
  /** Known source ids only. Empty: the agent cited nothing, or the line is the user's own. */
  sourceIds: string[];
  /** The user wrote this line themselves (kept by a refine), so it needs no source. */
  fromUser: boolean;
}

export interface SetupDraftSection {
  heading: string;
  claims: SetupClaim[];
  /** The claims as the section's text ("- ..." lines), what the section's text box starts with. */
  body: string;
}

/** A repo the draft suggests (quiet, or the main one) and why. */
export interface SetupRepoPick {
  repo: string;
  why: string;
  sourceIds: string[];
}

/** One repo the sweep saw, with how the user touched it. */
export interface SetupRepoCount {
  repo: string;
  prs: number;
  authored: number;
  reviewed: number;
  requested: number;
}

export interface SetupDraft {
  sections: SetupDraftSection[];
  quietRepos: SetupRepoPick[];
  mainRepo: SetupRepoPick | null;
  /** Every repo the sweep saw, busiest first: the quiet toggles and main repo radios. */
  repos: SetupRepoCount[];
  sources: SetupSource[];
  /** One or two sentences on what the draft is based on. */
  summary: string;
  /** Null for the blank template used when no agent draft came. */
  model: string | null;
}

export type SetupSweepStep = 'viewer' | 'teams' | 'activity' | 'codeowners' | 'digest' | 'draft';
export type SetupLineState = 'running' | 'done' | 'failed' | 'skipped';

/** One live progress line of the sweep. */
export interface SetupSweepLine {
  step: SetupSweepStep;
  text: string;
  state: SetupLineState;
}

/** instructions.md as it is now: a re-run shows the draft as a diff against it. */
export interface SetupCurrentInstructions {
  text: string;
  version: number | null;
}

/** The sweep job, polled while it runs (like the sync progress). */
export interface SetupSweepView {
  running: boolean;
  startedAt: IsoTime;
  finishedAt: IsoTime | null;
  lines: SetupSweepLine[];
  /** Set once the sweep finished: the agent's draft, or the blank template when that failed. */
  draft: SetupDraft | null;
  /** Why there is no agent draft, when there is none. */
  error: string | null;
  current: SetupCurrentInstructions;
  /** The viewer's teams and their roles, with a flip per team (2026-09-30). Null before the viewer is known. */
  teamRoles: TeamRolesView | null;
}

/** A section as the user left it in the review step. */
export interface SetupSectionEdit {
  heading: string;
  body: string;
}

/** "Tell the agent what's off": the draft as edited, plus the user's words. */
export interface SetupRefineRequest {
  sections: SetupSectionEdit[];
  message: string;
}

export interface SetupRefineResult {
  ok: boolean;
  /** The agent's one-line reply, or what went wrong. */
  message: string;
  draft: SetupDraft | null;
  /** Headings the refine added, changed or removed. */
  changedSections: string[];
}

/**
 * Why a line does not fit PostPile's instructions:
 * - no_effect: nothing PostPile does can follow it (a rule for a coding agent, pushing, merging).
 * - wrong_section: it would work, but under another heading.
 * - unclear: too vague for the agent to apply.
 */
export type SetupFitKind = 'no_effect' | 'wrong_section' | 'unclear';

/** One of the agent's notes from the fit check, pinned to a line the user has. */
export interface SetupFitNote {
  /** The section the line is in now. */
  heading: string;
  /** The line as the user wrote it, without its bullet. */
  line: string;
  kind: SetupFitKind;
  why: string;
  /** For wrong_section: the heading it belongs under. */
  moveTo: string | null;
  /** A wording that would fit, when the agent has one. */
  rewrite: string | null;
}

/** "Does this fit?" over the text the user is about to accept. */
export interface SetupFitRequest {
  sections: SetupSectionEdit[];
}

export interface SetupFitResult {
  ok: boolean;
  /** What went wrong, when not ok. */
  message: string;
  /** Empty when every line fits. */
  notes: SetupFitNote[];
}

export interface SetupAcceptRequest {
  sections: SetupSectionEdit[];
  /** Repos to make quiet. Repos left out are not touched. */
  quietRepos: string[];
  /** The repo scope to set; null for "All repos". */
  mainRepo: string | null;
  /** The instructions version the draft was reviewed against. A hand edit since then refuses the accept. */
  baseVersion: number | null;
}

export interface SetupAcceptResult extends ActionResult {
  /** The instructions version written; null when the text was unchanged or nothing was written. */
  savedVersion: number | null;
  /** On a refused accept because the file changed meanwhile: the file as it is now, to diff against again. */
  current: SetupCurrentInstructions | null;
}
