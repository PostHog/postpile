import type { IsoTime, Viewer } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';

const META_KEY = 'team_members';

/** Team membership changes rarely; one refresh a day is plenty. */
export const TEAM_MEMBERS_REFRESH_MS = 24 * 60 * 60 * 1000;

interface StoredTeam {
  etag: string | null;
  logins: string[];
}

interface StoredTeamMembers {
  fetchedAt: IsoTime;
  /** Keyed by "org/slug". */
  teams: Record<string, StoredTeam>;
}

function sameTeams(stored: StoredTeamMembers, teams: string[]): boolean {
  const known = Object.keys(stored.teams);
  return known.length === teams.length && teams.every((team) => team in stored.teams);
}

/**
 * Who else is on the viewer's teams (ghatchup's Meta.TeamMembers). Fetched
 * per team with ETags, at most once a day or when the viewer's teams change,
 * and kept in meta so reads and offline starts have it.
 */
export class TeamMembers {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
  ) {}

  private load(): StoredTeamMembers | null {
    const raw = this.store.meta.get(META_KEY);
    return raw ? (JSON.parse(raw) as StoredTeamMembers) : null;
  }

  private isDue(stored: StoredTeamMembers | null, teams: string[]): boolean {
    if (!stored || !sameTeams(stored, teams)) {
      return true;
    }
    return this.now().getTime() - new Date(stored.fetchedAt).getTime() >= TEAM_MEMBERS_REFRESH_MS;
  }

  private async fetch(stored: StoredTeamMembers | null, teams: string[]): Promise<StoredTeamMembers> {
    const result: StoredTeamMembers = { fetchedAt: this.now().toISOString(), teams: {} };
    for (const team of teams) {
      const previous = stored?.teams[team] ?? null;
      const answer = await this.reader.teamMembers(team, previous?.etag ?? null);
      result.teams[team] = answer.notModified ? (previous ?? { etag: null, logins: [] }) : { etag: answer.etag, logins: answer.logins };
    }
    return result;
  }

  /**
   * The viewer with `teamMembers` filled in: every login on their teams but
   * their own. A failed refresh keeps the last list; with no list at all
   * the viewer comes back unchanged and rules fall back to "any reviewer".
   */
  async attach(viewer: Viewer): Promise<Viewer> {
    let stored = this.load();
    if (this.isDue(stored, viewer.teams)) {
      try {
        stored = await this.fetch(stored, viewer.teams);
        this.store.meta.set(META_KEY, JSON.stringify(stored));
      } catch {
        // Team lists are a nicety; a sync must not fail over them. Next sync tries again.
      }
    }
    if (!stored) {
      return viewer;
    }
    const own = viewer.login.toLowerCase();
    const logins = viewer.teams.flatMap((team) => stored.teams[team]?.logins ?? []);
    const members = [...new Set(logins)].filter((login) => login.toLowerCase() !== own).sort();
    return { ...viewer, teamMembers: members };
  }
}
