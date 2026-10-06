// pr.mentioned_teams must answer exactly what `mentionsTeam` answers over
// the bodies it was computed from (DESIGN.md "PR storage").
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mentionsTeam } from './mentions.ts';
import { prTeamMentions, teamMentions } from './team-mentions.ts';
import { makeComment, makePr } from './fixtures.ts';
import { propertyRuns } from './testing/index.ts';

describe('teamMentions', () => {
  it('lists every mentioned team once, lowercased and sorted', () => {
    expect(teamMentions(['cc @Acme/Team-Platform and @acme/infra', 'again @acme/team-platform.'])).toEqual(['acme/infra', 'acme/team-platform']);
  });

  it('takes no team whose slug runs on, as mentionsTeam does', () => {
    expect(teamMentions(['@acme/team-platform-two', '@acme/team/sub', '@acme/team_x'])).toEqual(['acme/team-platform-two', 'acme/team_x']);
    expect(teamMentions(['x@acme/team', '@@acme/team', 'acme/team', '@acme/'])).toEqual(['acme/team']);
  });

  it('reads the PR body and every comment of the flat list', () => {
    const pr = makePr({ body: 'for @acme/infra', comments: [makeComment({ body: 'ping @acme/team-platform' })] });
    expect(prTeamMentions(pr)).toEqual(['acme/infra', 'acme/team-platform']);
  });

  it('agrees with mentionsTeam for every team over generated bodies', () => {
    const piece = fc.constantFrom('@', 'acme', 'Acme', '/', 'team', 'Team', '-', '_', 'x', '1', ' ', '.', '\n', 'é', '@acme/team');
    const body = fc.array(piece, { maxLength: 14 }).map((pieces) => pieces.join(''));
    const word = fc.stringMatching(/^[A-Za-z0-9-]{1,6}$/);
    const slug = fc.stringMatching(/^[A-Za-z0-9_-]{1,6}$/);
    const team = fc.oneof(fc.constantFrom('acme/team', 'Acme/Team-x', 'acme/team_1'), fc.tuple(word, slug).map(([org, name]) => `${org}/${name}`));
    fc.assert(
      fc.property(body, team, (text, name) => {
        expect(teamMentions([text]).includes(name.toLowerCase())).toBe(mentionsTeam(text, name));
      }),
      { numRuns: propertyRuns() * 5 },
    );
  });
});
