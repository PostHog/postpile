import type { TeamRoleView } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { teamRoleFlipLabel, teamRoleLine, teamRoleNotice } from './team-roles.ts';

const devex: TeamRoleView = { team: 'acme/team-devex', slug: 'team-devex', role: 'home', source: 'auto', reason: '57% of your reviews' };

describe('team role words', () => {
  it('says the role and why, and offers the other role', () => {
    expect(teamRoleLine(devex)).toBe('Home team (57% of your reviews)');
    expect(teamRoleLine({ ...devex, role: 'routing', reason: 'set by you' })).toBe('Routing only (set by you)');
    expect(teamRoleFlipLabel('home')).toBe('Make routing only');
    expect(teamRoleFlipLabel('routing')).toBe('Make home team');
  });

  it('says what a flip did', () => {
    expect(teamRoleNotice('team-devex', 'routing')).toBe('team-devex only routes reviews to you now');
    expect(teamRoleNotice('team-devex', 'home')).toBe('team-devex is a home team: its members are your teammates');
  });
});
