import type { ViewerView } from '@postpile/core';
import { visibleQueueFilters, type QueueFilter } from '../lib/queues.ts';

const LABELS: Record<QueueFilter, string> = { mine: 'my PRs', team: 'team PRs' };

const TITLES: Record<QueueFilter, string> = {
  mine: 'Only topics with an open PR of yours. Sections and tiles stay as they are.',
  team: 'Only topics with an open PR a teammate wrote. Sections and tiles stay as they are.',
};

/** Why an option is off, or null when it works. */
function disabledReason(filter: QueueFilter, count: number, viewer: ViewerView | undefined): string | null {
  if (!viewer?.login) {
    return 'No viewer yet: the first sync stores who you are';
  }
  if (filter === 'team' && viewer.teamMembers.length === 0) {
    return 'No team members fetched yet';
  }
  return count === 0 ? `No topic has ${LABELS[filter]} open` : null;
}

interface QueueFiltersProps {
  counts: Record<QueueFilter, number>;
  /** null is "any PR". */
  active: QueueFilter | null;
  viewer: ViewerView | undefined;
  onChange: (filter: QueueFilter | null) => void;
}

/**
 * "Topics with any PR | my PRs | team PRs" (2026-10-01). Worded as a
 * sentence so it reads as narrowing which topics show, not as tabs to
 * another list. A narrowing option on is drawn in the accent, so the state
 * is never in doubt; "any PR" is the way back.
 */
export function QueueFilters(props: QueueFiltersProps) {
  const options: (QueueFilter | null)[] = [null, ...visibleQueueFilters(props.viewer?.homeTeams, props.active)];
  return (
    <div className="@container flex items-center gap-2 px-1.5" role="group" aria-label="Show topics with">
      {/* The label gives way first when the sidebar is narrow: it hides whole rather than showing "T…". The group's aria-label keeps the sentence. */}
      <span className="hidden text-[12.5px] whitespace-nowrap text-muted @[270px]:inline">Topics with</span>
      <div className="flex shrink-0 rounded-control bg-segment p-0.5">
        {options.map((filter) => {
          const on = props.active === filter;
          const blocked = filter === null || on ? null : disabledReason(filter, props.counts[filter], props.viewer);
          const narrowing = on && filter !== null;
          const look = narrowing
            ? 'bg-surface font-semibold text-accent shadow-control ring-1 ring-accent'
            : on
              ? 'bg-surface font-semibold text-ink shadow-control'
              : 'text-ink-2 hover:text-ink disabled:opacity-50';
          return (
            <button
              key={filter ?? 'any'}
              type="button"
              aria-pressed={on}
              disabled={blocked !== null}
              title={blocked ?? (filter === null ? 'All topics' : TITLES[filter])}
              onClick={() => props.onChange(filter)}
              className={`h-6 rounded-[5px] px-2 text-[12px] whitespace-nowrap ${look}`}
            >
              {filter === null ? 'any PR' : LABELS[filter]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
