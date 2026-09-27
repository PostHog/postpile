// "Why it's here": a short code per PR in a tile and one for the tile, from
// the notification reason (provenance) plus what the PR says about the
// viewer and their teams. The UI shows it as a mono badge with a tooltip.
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { Pr, Provenance, Viewer } from './types.ts';

/**
 * RV review asked of you, RT review asked of your team, @ mentioned you,
 * @T mentioned your team, AS assigned, AU you wrote it, CM you took part,
 * FW following, ST pulled in as stack context.
 */
export type WhyCode = 'RV' | 'RT' | '@' | '@T' | 'AS' | 'AU' | 'CM' | 'FW' | 'ST';

/** Most aimed at the viewer first. A tile shows the first code any of its PRs has. */
export const WHY_ORDER: WhyCode[] = ['RV', '@', 'AS', 'RT', '@T', 'AU', 'CM', 'FW', 'ST'];

/**
 * GitHub says review_requested for personal and team requests alike. A
 * pending request names who; once the viewer reviewed, the request is gone
 * from the PR and only the timeline still has it. Without either, "you" is
 * the safer guess: it is the louder badge.
 */
function reviewRequestCode(pr: Pr, viewer: Viewer): 'RV' | 'RT' {
  if (pr.reviewerUsers.some((login) => sameLogin(login, viewer.login))) {
    return 'RV';
  }
  if (pr.reviewerTeams.some((team) => isOwnTeam(team, viewer.teams))) {
    return 'RT';
  }
  const requests = pr.timeline.filter((item) => item.kind === 'review_requested' && item.subject !== null);
  for (const item of requests.reverse()) {
    if (sameLogin(item.subject!, viewer.login)) {
      return 'RV';
    }
    if (isOwnTeam(item.subject!, viewer.teams)) {
      return 'RT';
    }
  }
  return 'RV';
}

/** The code for one PR in a tile. `pr` and `viewer` sharpen it; without them the reason alone decides. */
export function whyHere(provenance: Provenance, pr: Pr | null, viewer: Viewer | null): WhyCode {
  if (provenance.kind === 'pulled_in') {
    return 'ST';
  }
  const authored = pr !== null && viewer !== null && sameLogin(pr.author, viewer.login);
  switch (provenance.reason) {
    case 'review_requested':
    case 'approval_requested':
      return pr && viewer ? reviewRequestCode(pr, viewer) : 'RV';
    case 'mention':
      return '@';
    case 'team_mention':
      return '@T';
    case 'assign':
      return 'AS';
    case 'author':
      return 'AU';
    case 'comment':
    case 'state_change':
      return authored ? 'AU' : 'CM';
    case 'subscribed':
    case 'manual':
    case 'ci_activity':
    case 'other':
      return authored ? 'AU' : 'FW';
  }
}

/** The tile's code: the most aimed one among its PRs. ST when the list is empty. */
export function tileWhy(codes: WhyCode[]): WhyCode {
  let best: WhyCode = 'ST';
  for (const code of codes) {
    if (WHY_ORDER.indexOf(code) < WHY_ORDER.indexOf(best)) {
      best = code;
    }
  }
  return best;
}
