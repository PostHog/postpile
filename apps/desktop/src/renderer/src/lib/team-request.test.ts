import { describe, expect, it } from 'vitest';
import { removeTeamButtons } from './team-request.ts';

describe('removeTeamButtons', () => {
  it('offers one button per team of yours with a pending request', () => {
    expect(removeTeamButtons(['acme/team-platform', 'acme/team-web'])).toEqual([
      { team: 'acme/team-platform', label: 'Remove team-platform', question: 'Remove the review request for all of team-platform and unsubscribe you?' },
      { team: 'acme/team-web', label: 'Remove team-web', question: 'Remove the review request for all of team-web and unsubscribe you?' },
    ]);
  });

  it('offers nothing without a pending team request', () => {
    expect(removeTeamButtons([])).toEqual([]);
  });
});
