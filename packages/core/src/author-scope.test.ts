import { describe, expect, it } from 'vitest';
import { authorPlace, type HomeTeamMembers } from './author-scope.ts';

const HOME: HomeTeamMembers[] = [
  { team: 'acme/team-platform', members: ['you', 'lyra', 'rowan'] },
  { team: 'acme/team-web', members: ['rowan', 'nell'] },
];

describe('authorPlace', () => {
  it('is me when the viewer wrote the PR', () => {
    expect(authorPlace({ author: 'You', assignees: [] }, 'you', HOME)).toEqual({ scope: 'me', teams: [] });
  });

  it('names every home team the author is on', () => {
    expect(authorPlace({ author: 'rowan', assignees: [] }, 'you', HOME)).toEqual({ scope: 'my_team', teams: ['acme/team-platform', 'acme/team-web'] });
  });

  it('is others for an author on none of the home teams', () => {
    expect(authorPlace({ author: 'alice', assignees: [] }, 'you', HOME)).toEqual({ scope: 'others', teams: [] });
  });

  it('reads a bot PR as its assignees', () => {
    expect(authorPlace({ author: 'agent-bot', assignees: ['lyra'] }, 'you', HOME)).toEqual({ scope: 'my_team', teams: ['acme/team-platform'] });
    expect(authorPlace({ author: 'agent-bot', assignees: ['you'] }, 'you', HOME).scope).toBe('me');
  });

  it('is others without a viewer or home teams', () => {
    expect(authorPlace({ author: 'lyra', assignees: [] }, null, []).scope).toBe('others');
  });
});
