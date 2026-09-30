import {
  classifyTeams,
  daysBefore,
  mergeTeamRoles,
  setTeamRole,
  SWEEP_RETRY_MS,
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
import type { GitHubQuota } from './github-quota.ts';

const META_KEY = 'team_roles';
/** When a sync may try a failed classification again (ISO time), next to `team_roles`. */
const RETRY_KEY = 'team_roles_retry_after';

/**
 * The viewer's team roles (DESIGN.md "Team roles"), kept in meta
 * `team_roles`. Decided from GitHub reads (member counts and the last 90
 * days of reviews, a few GraphQL requests) when the setup sweep runs, and
 * during a sync for teams that have no role yet. A flip by the user sticks.
 * A failed classification waits SWEEP_RETRY_MS (2h, like a failed
 * work-context sweep) before a sync tries again, and a sync never tries
 * while the GitHub quota is low; the setup sweep and flips ignore both.
 */
export class TeamRoleKeeper {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
    private readonly quota: GitHubQuota,
    private readonly log: (line: string) => void = () => {},
  ) {}

  load(): TeamRoles | null {
    const raw = this.store.meta.get(META_KEY);
    return raw ? (JSON.parse(raw) as TeamRoles) : null;
  }

  private save(roles: TeamRoles): void {
    this.store.meta.set(META_KEY, JSON.stringify(roles));
  }

  /**
   * Reads the history and classifies `teams`; the rest of the stored roles
   * stay. Throws when GitHub fails. Partial answers (an org behind SAML SSO
   * shows no sizes and no reviews) still classify, by the size fallback:
   * the teams get a role and syncs stop asking; the setup sweep asks again.
   */
  private async readAndClassify(viewer: Viewer, teams: string[]): Promise<TeamRoles> {
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

  /** `readAndClassify`, remembering a failure: a sync waits SWEEP_RETRY_MS before it tries again. */
  private async classify(viewer: Viewer, teams: string[]): Promise<TeamRoles> {
    try {
      const roles = await this.readAndClassify(viewer, teams);
      this.store.meta.delete(RETRY_KEY);
      return roles;
    } catch (error) {
      this.store.meta.set(RETRY_KEY, new Date(this.now().getTime() + SWEEP_RETRY_MS).toISOString());
      throw error;
    }
  }

  /** A sync may classify: no failure in the last SWEEP_RETRY_MS, and the quota allows optional background reads. */
  private syncMayClassify(): boolean {
    const retryAfter = this.store.meta.get(RETRY_KEY);
    if (retryAfter !== null && this.now().toISOString() < retryAfter) {
      return false;
    }
    if (!this.quota.allowsBackground()) {
      this.log(`sync: team roles wait, GitHub quota low (${this.quota.describe()})`);
      return false;
    }
    return true;
  }

  /** The setup sweep: every team again, the user's flips stay. Throws when GitHub fails. */
  reclassify(viewer: Viewer): Promise<TeamRoles> {
    return this.classify(viewer, viewer.teams);
  }

  /**
   * The viewer with `homeTeams` set. Teams without a role (all of them on
   * an install from before roles, or a team the viewer just joined) are
   * classified first, unless a classification failed less than
   * SWEEP_RETRY_MS ago or the GitHub quota is low. A failed classification
   * never fails the sync: those teams stay home until a later sync tries
   * again.
   */
  async attach(viewer: Viewer): Promise<Viewer> {
    let roles = this.load();
    const missing = teamsWithoutRole(viewer.teams, roles);
    if (missing.length > 0 && this.syncMayClassify()) {
      try {
        roles = await this.classify(viewer, missing);
      } catch (error) {
        // Roles are a refinement; until they exist every team counts as home, like before.
        this.log(`sync: team roles failed, next try after ${this.store.meta.get(RETRY_KEY)}: ${error instanceof Error ? error.message : String(error)}`);
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
