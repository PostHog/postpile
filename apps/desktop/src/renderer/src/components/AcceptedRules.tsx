import type { RuleProposal } from '@postpile/core';
import { useActions } from '../api/actions.tsx';

/**
 * "Accepted rules" under Your instructions: the standing rules the user
 * accepted for every topic. They go into every prompt next to the
 * instructions, so they are listed here, each with Remove (logged, Undo in
 * the toast). Rules for one topic sit in that topic's "You told the agent"
 * lines instead.
 */
export function AcceptedRules(props: { rules: RuleProposal[] }) {
  const actions = useActions();
  if (props.rules.length === 0) {
    return <p className="text-xs text-hint">None yet. The agent proposes a rule in the Inbox after you correct the same thing a few times.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {props.rules.map((rule) => (
        <li key={rule.id} className="flex items-baseline gap-3 text-[12.5px] leading-normal">
          <span className="min-w-0 flex-1 text-ink select-text">{rule.text}</span>
          <button
            type="button"
            className="shrink-0 text-[11px] text-hint hover:text-ink hover:underline disabled:no-underline"
            disabled={actions.isBusy(`rule:${rule.id}`)}
            title="The agent stops applying this rule and does not propose it again. Undo in the toast."
            onClick={() => void actions.removeStandingRule(rule.id)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
