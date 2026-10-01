import type { AssigneeLine } from '../lib/assignees.ts';
import { Avatar } from './Avatar.tsx';

/**
 * "assigned to (face) rowan (face) sol +1" ("you" for the viewer): the people a PR is assigned to
 * when that is not just its author (`assigneeLine`), such as the person an
 * agent's bot opened the PR for. Quiet grey words, faces first; every name
 * is in the tooltip.
 */
export function AssignedTo(props: { line: AssigneeLine; className?: string }) {
  const { line } = props;
  return (
    <span title={line.title} className={`flex min-w-0 items-center gap-1 text-[11px] whitespace-nowrap text-hint ${props.className ?? ''}`}>
      assigned to
      {line.shown.map((assignee) => (
        <span key={assignee.login} className="flex min-w-0 items-center gap-1">
          <Avatar login={assignee.login} />
          <span className="truncate">{assignee.name}</span>
        </span>
      ))}
      {line.more > 0 && <span className="font-mono">+{line.more}</span>}
    </span>
  );
}
