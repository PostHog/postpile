// "For whom" a PR or tile is: the word chip and color band on tiles, built
// on the why-here codes (`whyHere`, `tileWhy`). Only the output changes: the
// codes still decide, the UI shows words instead of RV / RT / @ / ...
import { changesAnswered } from './changes-answered.ts';
import { isOwnTeam } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { requestedTeam, reviewRequest } from './review-request.ts';
import { teamMentions } from './team-mentions.ts';
import { isRoutingTeam, teamsHomeFirst } from './team-roles.ts';
import type { Pr, Viewer } from './types.ts';
import type { WhyCode } from './why-here.ts';

/**
 * you: asked of or addressed to the viewer personally (RV, @, AS), or a
 * home team request on a teammate's PR nobody else on the team covered yet.
 * team: one of their home teams is asked or mentioned and nothing is for
 * the viewer personally (RT, @T); `team` is the short slug ("team-platform").
 * routing: the same for a team that only routes reviews to them
 * (2026-09-30): neutral chip, no band, since sea means "your team".
 * own: the viewer wrote it (AU) or owns it (`prOwners`: a bot's PR assigned
 * to them). none: everything else, no chip, no band.
 */
export type ForWhom = { kind: 'you' } | { kind: 'team'; team: string } | { kind: 'routing'; team: string } | { kind: 'own' } | { kind: 'none' };

const RANK: Record<ForWhom['kind'], number> = { you: 0, team: 1, routing: 2, own: 3, none: 4 };

/** "acme/team-platform" -> "team-platform". */
function shortTeam(team: string): string {
  return team.split('/').pop() ?? team;
}

/**
 * Every team the PR body or a comment mentions, lowercased: every board
 * read sets `mentionedTeams` (from the header once the discussion is read
 * from rows), since it leaves bot bodies out. A PR with every body (a
 * fetch, `getFull`, a test) may lack it; its bodies are read instead.
 * `teamMentions` matches exactly what `mentionsTeam` matches.
 */
function mentionedTeams(pr: Pr): string[] {
  return pr.mentionedTeams ?? teamMentions([pr.body, ...pr.comments.flatMap((comment) => (comment.body === null ? [] : [comment.body]))]);
}

/**
 * Which of the viewer's teams the PR is for ("org/slug"): the pending
 * request, a timeline request, a mention, else the first home team. Home
 * teams go first at each step. Null when the viewer has no teams.
 */
function teamOf(pr: Pr | null, viewer: Viewer | null): string | null {
  const teams = viewer ? teamsHomeFirst(viewer) : [];
  if (pr && viewer) {
    const requested = requestedTeam(pr, viewer);
    if (requested) {
      return requested;
    }
    const inTimeline = pr.timeline.flatMap((item) => (item.kind === 'review_requested' && item.subject !== null ? [item.subject] : []));
    const timelineTeam = teams.find((team) => inTimeline.some((subject) => isOwnTeam(subject, [team])));
    if (timelineTeam) {
      return timelineTeam;
    }
    const named = mentionedTeams(pr);
    const mentioned = teams.find((team) => named.includes(team.toLowerCase()));
    if (mentioned) {
      return mentioned;
    }
  }
  return teams[0] ?? null;
}

/** The team chip: sea for a home team, neutral for a routing team. */
function teamChip(pr: Pr | null, viewer: Viewer | null): ForWhom {
  const team = teamOf(pr, viewer);
  if (team === null) {
    return { kind: 'team', team: 'your team' };
  }
  const routing = viewer !== null && isRoutingTeam(team, viewer);
  return routing ? { kind: 'routing', team: shortTeam(team) } : { kind: 'team', team: shortTeam(team) };
}

/**
 * For whom one PR is. The viewer's own PR is always "own", even when their
 * team got a review request on it (CODEOWNERS): it is never "for" them.
 */
export function forWhom(code: WhyCode, pr: Pr | null, viewer: Viewer | null): ForWhom {
  if (code === 'AU' || (pr !== null && viewer !== null && isPrOwner(pr, viewer.login))) {
    return { kind: 'own' };
  }
  // The author addressed the viewer's changes request: a re-review for them, whatever the notification said.
  if (pr !== null && viewer !== null && changesAnswered(pr, viewer) !== null) {
    return { kind: 'you' };
  }
  // A home team request on a teammate's PR that no other teammate covered yet counts like a personal one.
  if (pr !== null && viewer !== null && reviewRequest(pr, viewer) === 'team_for_you') {
    return { kind: 'you' };
  }
  switch (code) {
    case 'RV':
    case '@':
    case 'AS':
      return { kind: 'you' };
    case 'RT':
    case '@T':
      return teamChip(pr, viewer);
    default:
      return { kind: 'none' };
  }
}

/** The tile's: the most aimed among its PRs (you, then team, then routing, then own). None for an empty list. */
export function tileForWhom(prs: ForWhom[]): ForWhom {
  let best: ForWhom = { kind: 'none' };
  for (const entry of prs) {
    if (RANK[entry.kind] < RANK[best.kind]) {
      best = entry;
    }
  }
  return best;
}
