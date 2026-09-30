import type { TeamRoleView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { teamRoleFlipLabel, teamRoleFlipTitle, teamRoleLine } from '../lib/team-roles.ts';
import { Button } from './Button.tsx';

/**
 * One row per team: "team-devex · Home team (57% of your reviews) · Make
 * routing only". Words, no pictograms. Used under the setup sweep and in
 * "Your teams" below the instructions.
 */
export function TeamRolesList(props: { teams: TeamRoleView[] }) {
  const actions = useActions();
  return (
    <ul className="flex flex-col">
      {props.teams.map((team) => {
        const other = team.role === 'home' ? 'routing' : 'home';
        return (
          <li key={team.team} className="flex items-center gap-2 border-t border-hairline-soft py-1.5 first:border-t-0">
            <span className="font-mono text-[11.5px] text-ink" title={team.team}>
              {team.slug}
            </span>
            <span className="text-xs text-ink-2">· {teamRoleLine(team)}</span>
            <Button
              className="ml-auto"
              disabled={actions.isBusy(`teamRole:${team.team}`)}
              title={teamRoleFlipTitle(team)}
              onClick={() => void actions.setTeamRole(team, other)}
            >
              {teamRoleFlipLabel(team.role)}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
