import { describe, expect, it } from 'vitest';
import {
  classifyTeams,
  HOME_TEAM_MAX_MEMBERS,
  isHomeTeam,
  isRoutingTeam,
  MIN_REVIEWS_FOR_SHARE,
  mergeTeamRoles,
  setTeamRole,
  teamRoleReason,
  teamRolesLine,
  teamsWithoutRole,
  withHomeTeams,
  type ReviewedPr,
  type TeamRoles,
} from './team-roles.ts';
import type { Viewer } from './types.ts';

const DEVEX = 'acme/team-devex';
const APPROVERS = 'acme/client-approvers';

/** `count` reviews on PRs where only `requested` was asked. */
function reviews(count: number, requested: string[], start = 0): ReviewedPr[] {
  return Array.from({ length: count }, (_, index) => ({ key: `acme/app#${start + index}`, requested }));
}

const teams = [
  { team: DEVEX, members: 3 },
  { team: APPROVERS, members: 17 },
];

describe('classifyTeams', () => {
  it('makes a team home when at least 20% of the reviews came through it', () => {
    const history = [...reviews(57, [DEVEX]), ...reviews(4, [APPROVERS], 100), ...reviews(39, ['lyra'], 200)];
    const [devex, approvers] = classifyTeams({ login: 'alice', teams, reviews: history });
    expect(devex).toMatchObject({ team: DEVEX, role: 'home', basis: 'share', reviews: 57, share: 0.57, members: 3 });
    expect(approvers).toMatchObject({ team: APPROVERS, role: 'routing', basis: 'share', reviews: 4, share: 0.04 });
  });

  it('puts the line exactly at 20%', () => {
    const history = [...reviews(20, [DEVEX]), ...reviews(80, [])];
    expect(classifyTeams({ login: 'alice', teams, reviews: history })[0]!.role).toBe('home');
    const below = [...reviews(19, [DEVEX]), ...reviews(81, [])];
    expect(classifyTeams({ login: 'alice', teams, reviews: below })[0]!.role).toBe('routing');
  });

  it('does not count a review through the team when the viewer was also asked in person', () => {
    const history = [...reviews(40, [DEVEX, 'alice']), ...reviews(60, [])];
    const [devex] = classifyTeams({ login: 'alice', teams, reviews: history });
    expect(devex).toMatchObject({ role: 'routing', reviews: 0, share: 0 });
  });

  it('matches the personal request case-insensitively and ignores other people', () => {
    const history = [...reviews(30, [DEVEX, 'ALICE']), ...reviews(30, [DEVEX, 'lyra'], 100)];
    expect(classifyTeams({ login: 'alice', teams, reviews: history })[0]).toMatchObject({ reviews: 30, role: 'home' });
  });

  it('can find no home team at all', () => {
    const history = [...reviews(4, [APPROVERS]), ...reviews(4, [DEVEX], 50), ...reviews(92, ['alice'], 100)];
    const roles = classifyTeams({ login: 'alice', teams, reviews: history }).map((entry) => entry.role);
    expect(roles).toEqual(['routing', 'routing']);
  });

  it('falls back to the team size with fewer than 30 reviews', () => {
    const history = reviews(MIN_REVIEWS_FOR_SHARE - 1, [APPROVERS]);
    const [devex, approvers] = classifyTeams({ login: 'alice', teams, reviews: history });
    expect(devex).toMatchObject({ role: 'home', basis: 'size' });
    expect(approvers).toMatchObject({ role: 'routing', basis: 'size', reviews: 29, share: 1 });
  });

  it('keeps a team of exactly 10 home in the fallback, and one of unknown size too', () => {
    const sized = [
      { team: 'acme/ten', members: HOME_TEAM_MAX_MEMBERS },
      { team: 'acme/eleven', members: HOME_TEAM_MAX_MEMBERS + 1 },
      { team: 'acme/unknown', members: null },
    ];
    const roles = classifyTeams({ login: 'alice', teams: sized, reviews: [] }).map((entry) => [entry.role, entry.share]);
    expect(roles).toEqual([
      ['home', null],
      ['routing', null],
      ['home', null],
    ]);
  });

  it('counts a bot-made request like any other: the history only lists who was asked', () => {
    const history = [...reviews(30, [DEVEX]), ...reviews(70, [])];
    expect(classifyTeams({ login: 'alice', teams, reviews: history })[0]!.role).toBe('home');
  });
});

const stored: TeamRoles = {
  classifiedAt: '2026-09-30T08:00:00.000Z',
  reviewCount: 100,
  teams: {
    [DEVEX]: { role: 'home', source: 'auto', basis: 'share', reviews: 57, share: 0.57, members: 3 },
    [APPROVERS]: { role: 'routing', source: 'auto', basis: 'share', reviews: 4, share: 0.04, members: 17 },
  },
};

describe('mergeTeamRoles and setTeamRole', () => {
  it('never overwrites a role the user set, but refreshes its numbers', () => {
    const flipped = setTeamRole(stored, APPROVERS, 'home');
    expect(flipped.teams[APPROVERS]).toMatchObject({ role: 'home', source: 'user', basis: 'user' });
    const again = mergeTeamRoles(
      flipped,
      [
        { team: APPROVERS, role: 'routing', basis: 'share', reviews: 6, share: 0.06, members: 18 },
        { team: DEVEX, role: 'routing', basis: 'share', reviews: 10, share: 0.1, members: 3 },
      ],
      100,
      '2026-10-01T08:00:00.000Z',
    );
    expect(again.teams[APPROVERS]).toMatchObject({ role: 'home', source: 'user', reviews: 6, members: 18 });
    expect(again.teams[DEVEX]).toMatchObject({ role: 'routing', source: 'auto' });
    expect(again.classifiedAt).toBe('2026-10-01T08:00:00.000Z');
  });

  it('adds a new team and keeps the ones not classified this time', () => {
    const merged = mergeTeamRoles(stored, [{ team: 'acme/infra', role: 'home', basis: 'size', reviews: 0, share: null, members: 4 }], 0, stored.classifiedAt);
    expect(Object.keys(merged.teams)).toEqual([DEVEX, APPROVERS, 'acme/infra']);
    expect(merged.teams[DEVEX]).toEqual(stored.teams[DEVEX]);
  });

  it('lists the teams without a role', () => {
    expect(teamsWithoutRole([DEVEX, 'acme/infra'], stored)).toEqual(['acme/infra']);
    expect(teamsWithoutRole([DEVEX], null)).toEqual([DEVEX]);
  });
});

describe('home teams on the viewer', () => {
  const viewer: Viewer = { login: 'alice', teams: [DEVEX, APPROVERS, 'acme/infra'] };

  it('keeps every team home without roles, and a team without a role home until classified', () => {
    expect(withHomeTeams(viewer, null).homeTeams).toBeUndefined();
    expect(withHomeTeams(viewer, stored).homeTeams).toEqual([DEVEX, 'acme/infra']);
    expect(isHomeTeam(APPROVERS, viewer)).toBe(true);
    expect(isRoutingTeam(APPROVERS, viewer)).toBe(false);
  });

  it('tells home from routing teams, by full name or bare slug', () => {
    const roled = withHomeTeams(viewer, stored);
    expect(isHomeTeam('team-devex', roled)).toBe(true);
    expect(isRoutingTeam('client-approvers', roled)).toBe(true);
    expect(isRoutingTeam(APPROVERS, roled)).toBe(true);
    expect(isHomeTeam(APPROVERS, roled)).toBe(false);
    expect(isRoutingTeam('acme/other', roled)).toBe(false);
  });

  it('allows no home team', () => {
    const none = withHomeTeams(viewer, setTeamRole(setTeamRole(stored, DEVEX, 'routing'), 'acme/infra', 'routing'));
    expect(none.homeTeams).toEqual([]);
    expect(isHomeTeam(DEVEX, none)).toBe(false);
  });
});

describe('wording', () => {
  it('says why a team has its role', () => {
    expect(teamRoleReason(stored.teams[DEVEX]!)).toBe('57% of your reviews');
    expect(teamRoleReason({ ...stored.teams[DEVEX]!, basis: 'size' })).toBe('3 members');
    expect(teamRoleReason({ ...stored.teams[DEVEX]!, basis: 'size', members: null })).toBe('size unknown');
    expect(teamRoleReason(setTeamRole(stored, DEVEX, 'routing').teams[DEVEX]!)).toBe('set by you');
  });

  it('writes the sweep line', () => {
    expect(teamRolesLine(stored, [DEVEX, APPROVERS])).toBe(
      'Home team: team-devex (57% of your reviews came through it) · Routing only: client-approvers (4% of your reviews came through it)',
    );
    const none = setTeamRole(stored, DEVEX, 'routing');
    expect(teamRolesLine(none, [DEVEX, APPROVERS])).toBe(
      'No home team: your teams only route reviews to you · Routing only: team-devex (set by you), client-approvers (4% of your reviews came through it)',
    );
  });
});
