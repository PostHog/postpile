// "Remove <team>" in the detail pane (DESIGN.md "Actions act on what you
// look at", 2026-09-29): removes a team's review request and unsubscribes
// the user from the PR's thread. Final, so it asks once before it runs.
import type { PrSummary } from '@postpile/core';

export interface RemoveTeamButton {
  /** The team as GitHub lists it ("acme/team-devex"); the server takes this. */
  team: string;
  /** "Remove team-devex". */
  label: string;
  /** The one-sentence confirm. */
  question: string;
}

/**
 * One button per team of the viewer's with a pending review request on the
 * selected PR (`PrSummary.ownTeamRequests`, empty on merged or closed PRs).
 * None without a row for the PR.
 */
export function removeTeamButtons(pr: Pick<PrSummary, 'ownTeamRequests'> | null): RemoveTeamButton[] {
  return (pr?.ownTeamRequests ?? []).map((team) => {
    const slug = team.split('/').pop() ?? team;
    return { team, label: `Remove ${slug}`, question: `Remove the review request for all of ${slug} and unsubscribe you?` };
  });
}
