// Team roles in fake mode: team-platform is the home team, client-approvers
// only routes reviews to the viewer. A flip changes the sample viewer, so
// the Team filter, faces and chips follow it like in the real app.
import { setTeamRole, teamRolesView, withHomeTeams, type TeamMembersView, type TeamRole, type TeamRoles, type TeamRolesView } from '@postpile/core';
import type { SampleData } from './sample-data.ts';

/** Whose members are the sample teammates. Other teams have none in the sample. */
const MEMBERS_TEAM = 'acme/team-platform';

function sampleRoles(now: () => Date): TeamRoles {
  return {
    classifiedAt: now().toISOString(),
    reviewCount: 100,
    teams: {
      'acme/team-platform': { role: 'home', source: 'auto', basis: 'share', reviews: 57, share: 0.57, members: 5 },
      'acme/client-approvers': { role: 'routing', source: 'auto', basis: 'share', reviews: 4, share: 0.04, members: 17 },
    },
  };
}

export class FakeTeamRoles {
  private roles: TeamRoles;
  /** The members of the sample's home team, kept while it is not home. */
  private readonly members: string[];
  /** The sample's member lists count as fetched when the fake engine starts. */
  private readonly membersFetchedAt: string;

  constructor(
    private readonly data: SampleData,
    now: () => Date,
  ) {
    this.roles = sampleRoles(now);
    this.members = data.viewerTeamMembers;
    this.membersFetchedAt = now().toISOString();
  }

  view(): TeamRolesView {
    return teamRolesView(this.data.viewerTeams, this.roles);
  }

  /** Who is on each home team, the viewer included: only team-platform has members in the sample. */
  membersView(): TeamMembersView {
    const teams = this.data.viewerHomeTeams.map((team) => ({ team, members: team === MEMBERS_TEAM ? [this.data.viewer, ...this.data.viewerTeamMembers] : [] }));
    return { fetchedAt: this.membersFetchedAt, teams };
  }

  setRole(team: string, role: TeamRole): TeamRolesView {
    if (!this.data.viewerTeams.includes(team)) {
      throw new Error(`not one of your teams: ${team}`);
    }
    this.roles = setTeamRole(this.roles, team, role);
    const viewer = withHomeTeams({ login: this.data.viewer, teams: this.data.viewerTeams }, this.roles);
    this.data.viewerHomeTeams = viewer.homeTeams ?? this.data.viewerTeams;
    this.data.viewerTeamMembers = this.data.viewerHomeTeams.includes(MEMBERS_TEAM) ? this.members : [];
    return this.view();
  }
}
