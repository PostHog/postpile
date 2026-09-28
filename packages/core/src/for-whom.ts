// "For whom" a PR or tile is: the word chip and color band on tiles, built
// on the why-here codes (`whyHere`, `tileWhy`). Only the output changes: the
// codes still decide, the UI shows words instead of RV / RT / @ / ...
import { changesAnswered } from './changes-answered.ts';
import { isOwnTeam, mentionsTeam, sameLogin } from './mentions.ts';
import type { Pr, Viewer } from './types.ts';
import type { WhyCode } from './why-here.ts';

/**
 * you: asked of or addressed to the viewer personally (RV, @, AS).
 * team: one of their teams is asked or mentioned and nothing is for the
 * viewer personally (RT, @T); `team` is the short slug ("team-devex").
 * own: the viewer wrote it (AU). none: everything else, no chip, no band.
 */
export type ForWhom = { kind: 'you' } | { kind: 'team'; team: string } | { kind: 'own' } | { kind: 'none' };

const RANK: Record<ForWhom['kind'], number> = { you: 0, team: 1, own: 2, none: 3 };

/** "PostHog/team-devex" -> "team-devex". */
function shortTeam(team: string): string {
  return team.split('/').pop() ?? team;
}

/** Which of the viewer's teams the PR is for: a pending request, a timeline request, a mention, else the first team. */
function teamOf(pr: Pr | null, viewer: Viewer | null): string {
  const teams = viewer?.teams ?? [];
  if (pr) {
    const requested = pr.reviewerTeams.find((team) => isOwnTeam(team, teams));
    if (requested) {
      return shortTeam(requested);
    }
    const inTimeline = pr.timeline.find((item) => item.kind === 'review_requested' && item.subject !== null && isOwnTeam(item.subject, teams));
    if (inTimeline?.subject) {
      return shortTeam(inTimeline.subject);
    }
    const bodies = [pr.body, ...pr.comments.map((comment) => comment.body)];
    const mentioned = teams.find((team) => bodies.some((body) => mentionsTeam(body, team)));
    if (mentioned) {
      return shortTeam(mentioned);
    }
  }
  return teams[0] ? shortTeam(teams[0]) : 'your team';
}

/**
 * For whom one PR is. The viewer's own PR is always "own", even when their
 * team got a review request on it (CODEOWNERS): it is never "for" them.
 */
export function forWhom(code: WhyCode, pr: Pr | null, viewer: Viewer | null): ForWhom {
  if (code === 'AU' || (pr !== null && viewer !== null && sameLogin(pr.author, viewer.login))) {
    return { kind: 'own' };
  }
  // The author addressed the viewer's changes request: a re-review for them, whatever the notification said.
  if (pr !== null && viewer !== null && !pr.isDraft && changesAnswered(pr, viewer) !== null) {
    return { kind: 'you' };
  }
  switch (code) {
    case 'RV':
    case '@':
    case 'AS':
      return { kind: 'you' };
    case 'RT':
    case '@T':
      return { kind: 'team', team: teamOf(pr, viewer) };
    default:
      return { kind: 'none' };
  }
}

/** The tile's: the most aimed among its PRs (you, then team, then own). None for an empty list. */
export function tileForWhom(prs: ForWhom[]): ForWhom {
  let best: ForWhom = { kind: 'none' };
  for (const entry of prs) {
    if (RANK[entry.kind] < RANK[best.kind]) {
      best = entry;
    }
  }
  return best;
}
