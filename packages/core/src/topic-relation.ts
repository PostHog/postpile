// How a topic reaches the user, from what the engine already stores. Rules
// decide the clear cases; the dossier update decides the rest.

import { sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { homeTeamsOf } from './team-roles.ts';
import type { DossierRelation, TopicRelation } from './memory.ts';
import type { TopicPlacement } from './views.ts';
import type { NotificationReason, NotificationThread, Pr, Viewer } from './types.ts';

export interface RelationInput {
  viewer: Viewer;
  /** Member PRs of the topic. */
  prs: Pr[];
  /** Notification threads of those PRs. */
  threads: NotificationThread[];
  driver: string | null;
}

/** What the rules could tell. relation null means ambiguous: the agent decides. */
export interface RelationSignals {
  relation: TopicRelation | null;
  ownerTeam: string | null;
  whyYou: string;
  /** Every signal seen, for the prompt. */
  notes: string[];
}

/** Reasons that mean GitHub asked for the user or their team, not just kept them posted. */
const DIRECT_REASONS: NotificationReason[] = ['review_requested', 'mention', 'team_mention', 'author', 'assign', 'approval_requested'];

function shortTeam(team: string): string {
  return team.split('/').at(-1) ?? team;
}

/** Top directory of the files the PRs touch most, e.g. ".github/workflows". */
function mainArea(prs: Pr[]): string | null {
  const counts = new Map<string, number>();
  for (const file of prs.flatMap((pr) => pr.files)) {
    const dir = file.path.split('/').slice(0, 2).join('/');
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [dir, count] of counts) {
    if (count > bestCount) {
      best = dir;
      bestCount = count;
    }
  }
  return best;
}

/**
 * In order: the user authors or drives the work -> team. Only passive
 * threads (subscribed, comment, state change, CI) -> fyi. A review request
 * to one of the user's teams or to the user -> ambiguous (team or routed),
 * with the reason as whyYou; the agent decides from the dossier.
 */
export function relationSignals(input: RelationInput): RelationSignals {
  const { viewer } = input;
  const notes: string[] = [];
  const authored = input.prs.some((pr) => isPrOwner(pr, viewer.login));
  const drives = input.driver !== null && sameLogin(input.driver, viewer.login);
  const ownTeam = homeTeamsOf(viewer)[0] ?? null;
  if (authored || drives) {
    notes.push(drives ? 'the user drives this topic' : 'the user authored PRs here');
    return { relation: 'team', ownerTeam: ownTeam, whyYou: drives ? 'you drive it' : 'you author PRs here', notes };
  }
  const reasons = [...new Set(input.threads.map((thread) => thread.reason))];
  notes.push(`notification reasons: ${reasons.join(', ') || 'none'}`);
  const teamRequested = [...new Set(input.prs.flatMap((pr) => pr.reviewerTeams).filter((team) => viewer.teams.includes(team)))];
  const area = mainArea(input.prs);
  if (teamRequested.length > 0) {
    const where = area ? ` on ${area}` : '';
    notes.push(`review requested from the user's team ${teamRequested.join(', ')}${where}`);
    return { relation: null, ownerTeam: null, whyYou: `${shortTeam(teamRequested[0]!)} review requested${where}`, notes };
  }
  if (input.prs.some((pr) => pr.reviewerUsers.some((user) => sameLogin(user, viewer.login))) || reasons.includes('review_requested')) {
    notes.push('review requested from the user directly');
    return { relation: null, ownerTeam: null, whyYou: 'your review requested', notes };
  }
  if (reasons.some((reason) => DIRECT_REASONS.includes(reason))) {
    const why = reasons.includes('team_mention') ? 'your team was mentioned' : 'you were mentioned';
    notes.push(why);
    return { relation: null, ownerTeam: null, whyYou: why, notes };
  }
  return { relation: 'fyi', ownerTeam: null, whyYou: reasons.includes('subscribed') ? 'subscribed' : 'following along', notes };
}

/** A relation the user set with "Wrong", valid while nothing new happened in the topic. */
export interface RelationOverride {
  relation: TopicRelation;
  /** Event log seq when the user set it. New events past it are new evidence. */
  seq: number;
}

/** The placement the UI shows: the user's correction while it holds, else the dossier's relation. */
export function topicPlacement(
  relation: DossierRelation | undefined,
  area: string | null,
  override: RelationOverride | null,
  eventsSinceOverride: number,
): TopicPlacement | null {
  const overrideHolds = override !== null && eventsSinceOverride === 0;
  if (!relation && !overrideHolds) {
    return null;
  }
  return {
    relation: overrideHolds ? override.relation : relation!.kind,
    ownerTeam: relation?.ownerTeam ?? null,
    whyYou: relation?.whyYou ?? '',
    area,
    corrected: overrideHolds,
  };
}
