import type { Dossier } from './memory.ts';

/**
 * Size bounds for a dossier. The agent is asked to stay inside them and
 * clampDossier enforces them after parsing, so one long answer cannot grow
 * every later prompt. Rendered as text the whole dossier stays under ~8k chars.
 */
export const DOSSIER_LIMITS = {
  goal: 300,
  summary: 600,
  statusNote: 200,
  people: 8,
  personNote: 120,
  openQuestions: 8,
  questionText: 200,
  timeline: 40,
  timelineRole: 120,
  earlier: 600,
  userCares: 6,
  careText: 160,
  recentChanges: 12,
  changeText: 160,
  /** A brief for topic assignment and consolidation prompts. */
  brief: 400,
} as const;

/** The dossier of a topic nobody has written up yet. */
export function emptyDossier(): Dossier {
  return {
    goal: '',
    summary: '',
    status: 'starting',
    statusNote: '',
    people: [],
    openQuestions: [],
    timeline: [],
    earlier: '',
    userCares: [],
    recentChanges: [],
  };
}

/**
 * Cuts every list and string to DOSSIER_LIMITS. Lists keep their most useful
 * end: timeline keeps the newest entries (the dropped ones belong in
 * `earlier`), recentChanges keeps the newest, the rest keep their first items.
 */
export function clampDossier(dossier: Dossier): Dossier {
  throw new Error(`not implemented: clampDossier (${dossier.status})`);
}

/** Goal, status and driver in at most DOSSIER_LIMITS.brief chars, for prompts that list many topics. */
export function dossierBrief(dossier: Dossier): string {
  throw new Error(`not implemented: dossierBrief (${dossier.status})`);
}
