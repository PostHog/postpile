// "Remove <team>" in the detail pane (DESIGN.md "Actions act on what you
// look at", 2026-09-29): removes a team's review request and unsubscribes
// the user from the PR's thread. Final, so it asks once before it runs.
export interface RemoveTeamButton {
  /** The team as GitHub lists it ("acme/team-devex"); the server takes this. */
  team: string;
  /** "Remove team-devex". */
  label: string;
  /** The one-sentence confirm. */
  question: string;
}

/**
 * One button per team core offers for the selected PR
 * (`PaneOffers.removeTeams`: the viewer's teams with a pending review
 * request, none on a merged, closed or done PR).
 */
export function removeTeamButtons(teams: string[]): RemoveTeamButton[] {
  return teams.map((team) => {
    const slug = team.split('/').pop() ?? team;
    return { team, label: `Remove ${slug}`, question: `Remove the review request for all of ${slug}, unsubscribe you and mark it read?` };
  });
}
