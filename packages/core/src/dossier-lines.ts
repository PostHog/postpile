import type { Dossier, LineSources } from './memory.ts';

/** One dossier line the user can ask "Why?" about. */
export interface DossierLine {
  /** "goal", "status", or "openQuestions[2]", "timeline[5]", "userCares[0]", "recentChanges[1]". */
  path: string;
  text: string;
  /** Empty for lines from versions stored before lines carried sources. */
  sources: LineSources;
}

const LIST_PATH = /^(openQuestions|timeline|userCares|recentChanges)\[(\d+)\]$/;

function sources(line: Partial<LineSources> | undefined): LineSources {
  return { refs: line?.refs ?? [], userRefs: line?.userRefs ?? [] };
}

/** "active: Backend moved, no blockers", as the status line reads. */
export function dossierStatusText(dossier: Dossier): string {
  return dossier.statusNote ? `${dossier.status}: ${dossier.statusNote}` : dossier.status;
}

const RELATION_WORDS = { team: 'Your team', routed: 'Routed to you', fyi: 'FYI' } as const;

/** "Routed to you: owned by PostHog/team-infra, CODEOWNERS on .github/workflows". */
export function relationText(relation: NonNullable<Dossier['relation']>): string {
  const owner = relation.ownerTeam ? `owned by ${relation.ownerTeam}, ` : '';
  return `${RELATION_WORDS[relation.kind]}: ${owner}${relation.whyYou}`;
}

/** The line at `path`, or null when the path does not point at one. */
export function findDossierLine(dossier: Dossier, path: string): DossierLine | null {
  if (path === 'goal') {
    return dossier.goal ? { path, text: dossier.goal, sources: sources(dossier.goalSources) } : null;
  }
  if (path === 'status') {
    return { path, text: dossierStatusText(dossier), sources: sources(dossier.statusSources) };
  }
  if (path === 'relation') {
    return dossier.relation ? { path, text: relationText(dossier.relation), sources: sources(dossier.relation) } : null;
  }
  const match = LIST_PATH.exec(path);
  if (!match) {
    return null;
  }
  const index = Number(match[2]);
  if (match[1] === 'openQuestions') {
    const question = dossier.openQuestions[index];
    return question ? { path, text: question.text, sources: sources(question) } : null;
  }
  if (match[1] === 'timeline') {
    const entry = dossier.timeline[index];
    return entry ? { path, text: `${entry.prKey}: ${entry.role}`, sources: sources(entry) } : null;
  }
  if (match[1] === 'userCares') {
    const care = dossier.userCares[index];
    return care ? { path, text: care.text, sources: sources(care) } : null;
  }
  const change = dossier.recentChanges[index];
  return change ? { path, text: change.text, sources: sources(change) } : null;
}
