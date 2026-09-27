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

/** Cuts text to max chars, marking the cut with an ellipsis. */
export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Cuts every list and string to DOSSIER_LIMITS. Lists keep their most useful
 * end: timeline keeps the newest entries (the dropped ones belong in
 * `earlier`), recentChanges keeps the newest, the rest keep their first items.
 */
export function clampDossier(dossier: Dossier): Dossier {
  const limits = DOSSIER_LIMITS;
  return {
    goal: clipText(dossier.goal, limits.goal),
    summary: clipText(dossier.summary, limits.summary),
    status: dossier.status,
    statusNote: clipText(dossier.statusNote, limits.statusNote),
    people: dossier.people
      .slice(0, limits.people)
      .map((person) => ({ ...person, note: clipText(person.note, limits.personNote) })),
    openQuestions: dossier.openQuestions
      .slice(0, limits.openQuestions)
      .map((question) => ({ ...question, text: clipText(question.text, limits.questionText) })),
    timeline: dossier.timeline
      .slice(-limits.timeline)
      .map((entry) => ({ ...entry, role: clipText(entry.role, limits.timelineRole) })),
    earlier: clipText(dossier.earlier, limits.earlier),
    userCares: dossier.userCares
      .slice(0, limits.userCares)
      .map((care) => ({ ...care, text: clipText(care.text, limits.careText) })),
    recentChanges: dossier.recentChanges
      .slice(0, limits.recentChanges)
      .map((change) => ({ ...change, text: clipText(change.text, limits.changeText) })),
  };
}

function statusLine(dossier: Dossier): string {
  const note = dossier.statusNote.trim();
  return note === '' ? `Status: ${dossier.status}.` : `Status: ${dossier.status} - ${note}.`;
}

function driverLine(dossier: Dossier): string {
  const drivers = dossier.people.filter((person) => person.role === 'driver').map((person) => `@${person.login}`);
  return drivers.length === 0 ? '' : `Driver: ${drivers.join(', ')}.`;
}

/**
 * Goal, status and driver in at most DOSSIER_LIMITS.brief chars, for prompts
 * that list many topics. The goal is cut first so status and driver survive.
 */
export function dossierBrief(dossier: Dossier): string {
  const max = DOSSIER_LIMITS.brief;
  const tail = [statusLine(dossier), driverLine(dossier)].filter((part) => part !== '').join(' ');
  const goal = dossier.goal.trim();
  if (goal === '') {
    return clipText(tail, max);
  }
  const room = max - tail.length - 1;
  if (room < 20) {
    return clipText(`${goal} ${tail}`, max);
  }
  return `${clipText(goal, room)} ${tail}`;
}
