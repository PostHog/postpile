import {
  classifyTeams,
  daysBefore,
  mergeTeamRoles,
  setTeamRole,
  TEAM_ROLE_PR_CAP,
  TEAM_ROLE_WINDOW_DAYS,
  teamRolesView,
  teamsWithoutRole,
  viewerOrgs,
  withHomeTeams,
  type TeamRole,
  type TeamRoles,
  type TeamRolesView,
  type Viewer,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';

const META_KEY = 'team_roles';

/**
 * The viewer's team roles (DESIGN.md "Team roles"), kept in meta
 * `team_roles`. Decided from GitHub reads (member counts and the last 90
 * days of reviews, a few GraphQL requests) when the setup sweep runs, and
 * during a sync for teams that have no role yet. A flip by the user sticks.
 */
export class TeamRoleKeeper {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
  ) {}

  load(): TeamRoles | null {
    const raw = this.store.meta.get(META_KEY);
    return raw ? (JSON.parse(raw) as TeamRoles) : null;
  }

  private save(roles: TeamRoles): void {
    this.store.meta.set(META_KEY, JSON.stringify(roles));
  }

  /** Reads the history and classifies `teams`; the rest of the stored roles stay. Throws when GitHub fails. */
  private async classify(viewer: Viewer, teams: string[]): Promise<TeamRoles> {
    const at = this.now().toISOString();
    const since = daysBefore(at, TEAM_ROLE_WINDOW_DAYS).slice(0, 10);
    const sizes = await this.reader.teamSizes(viewer.login);
    const reviews = await this.reader.reviewedPrRequests(viewer.login, viewerOrgs(viewer.teams), since, TEAM_ROLE_PR_CAP);
    const wanted = teams.map((team) => ({ team, members: sizes.find((size) => size.team.toLowerCase() === team.toLowerCase())?.members ?? null }));
    const classified = classifyTeams({ login: viewer.login, teams: wanted, reviews });
    const roles = mergeTeamRoles(this.load(), classified, reviews.length, at);
    this.save(roles);
    return roles;
  }

  /** The setup sweep: every team again, the user's flips stay. Throws when GitHub fails. */
  reclassify(viewer: Viewer): Promise<TeamRoles> {
    return this.classify(viewer, viewer.teams);
  }

  /**
   * The viewer with `homeTeams` set. Teams without a role (all of them on
   * an install from before roles, or a team the viewer just joined) are
   * classified first. A failed classification never fails the sync: those
   * teams stay home until the next sync tries again.
   */
  async attach(viewer: Viewer): Promise<Viewer> {
    let roles = this.load();
    const missing = teamsWithoutRole(viewer.teams, roles);
    if (missing.length > 0) {
      try {
        roles = await this.classify(viewer, missing);
      } catch {
        // Roles are a refinement; until they exist every team counts as home, like before.
      }
    }
    return withHomeTeams(viewer, roles);
  }

  /** The user flips one team. Works before any classification too. */
  setRole(team: string, role: TeamRole): TeamRoles {
    const current = this.load() ?? { classifiedAt: this.now().toISOString(), reviewCount: 0, teams: {} };
    const roles = setTeamRole(current, team, role);
    this.save(roles);
    return roles;
  }

  view(viewer: Viewer | null): TeamRolesView {
    return teamRolesView(viewer?.teams ?? [], this.load());
  }
}
