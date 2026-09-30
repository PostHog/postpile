import type { AssigneeLine } from '../lib/assignees.ts';
import { Avatar } from './Avatar.tsx';

/**
 * "assigned to (face) rowan (face) sol +1": the people a PR is assigned to
 * when that is not just its author (`assigneeLine`), such as the person an
 * agent's bot opened the PR for. Quiet grey words, faces first; every name
 * is in the tooltip.
 */
export function AssignedTo(props: { line: AssigneeLine }) {
  const { line } = props;
  return (
    <span title={line.title} className="flex min-w-0 items-center gap-1 text-[11px] whitespace-nowrap text-hint">
      assigned to
      {line.shown.map((login) => (
        <span key={login} className="flex min-w-0 items-center gap-1">
          <Avatar login={login} />
          <span className="truncate">{login}</span>
        </span>
      ))}
      {line.more > 0 && <span className="font-mono">+{line.more}</span>}
    </span>
  );
}
