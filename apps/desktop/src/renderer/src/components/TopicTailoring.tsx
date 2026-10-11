import { useActions } from '../api/actions.tsx';
import { TAILORING_HEADER, tailoringLines } from '../lib/tailoring.ts';
import { QuoteIcon } from './icons.tsx';

/**
 * What the topic keeps in mind (its tailoring), one entry per line: what
 * the user kept from the agent chat, accepted topic rules, lessons kept in
 * the topic ("From your review on #4521: ...") and lines a merge brought
 * along ("From Frontend build: ..."). Each line has Remove, which logs the
 * removal; the toast offers Undo. Renders nothing without tailoring.
 */
export function TopicTailoring(props: { topicId: string; tailoring: string }) {
  const actions = useActions();
  const lines = tailoringLines(props.tailoring);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="mt-2.5 flex max-w-[680px] items-start gap-2 text-xs leading-normal text-muted">
      <span className="pt-px text-faint">
        <QuoteIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{TAILORING_HEADER}</span>
        <ul className="flex flex-col gap-0.5">
          {lines.map((line, index) => (
            <li key={`${index}:${line}`} className="group flex items-baseline gap-2">
              <span className="min-w-0 text-ink-2 select-text">{line}</span>
              <button
                type="button"
                className="shrink-0 text-[11px] text-hint hover:text-ink hover:underline disabled:no-underline"
                disabled={actions.isBusy(`tailoring:${props.topicId}:${line}`)}
                title="The agent stops applying this in this topic. Undo in the toast."
                onClick={() => void actions.removeTailoringLine(props.topicId, line)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
