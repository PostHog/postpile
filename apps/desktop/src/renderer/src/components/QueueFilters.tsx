import type { ViewerView } from '@postpile/core';
import { QUEUE_FILTERS, type QueueFilter } from '../lib/queues.ts';
import { Avatar } from './Avatar.tsx';

const LABELS: Record<QueueFilter, string> = { mine: 'Mine', team: 'Team', reply: 'Reply', review: 'Review' };

const TITLES: Record<QueueFilter, string> = {
  mine: 'Topics with an open PR you wrote',
  team: 'Topics with an open PR a teammate wrote',
  reply: 'Topics where someone waits for your answer',
  review: 'Topics with a review asked of you or your team',
};

/** Mine shows your face, Team up to three teammates; Reply and Review have none. */
function facesFor(filter: QueueFilter, viewer: ViewerView | undefined): string[] {
  if (filter === 'mine') {
    return viewer?.login ? [viewer.login] : [];
  }
  return filter === 'team' ? (viewer?.teamMembers ?? []).slice(0, 3) : [];
}

/** Why a button is off, or null when it works. */
function disabledReason(filter: QueueFilter, count: number, viewer: ViewerView | undefined): string | null {
  if ((filter === 'mine' || filter === 'team') && !viewer?.login) {
    return 'No viewer yet: the first sync stores who you are';
  }
  if (filter === 'team' && viewer?.teamMembers.length === 0) {
    return 'No team members fetched yet';
  }
  return count === 0 ? `No PRs match ${LABELS[filter]}` : null;
}

interface QueueFiltersProps {
  counts: Record<QueueFilter, number>;
  active: QueueFilter | null;
  viewer: ViewerView | undefined;
  /** Clicking the active button again clears the filter (null). */
  onChange: (filter: QueueFilter | null) => void;
}

/** The pill buttons above the sections; one filter at a time, always two by two. */
export function QueueFilters(props: QueueFiltersProps) {
  return (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="Filter topics">
      {QUEUE_FILTERS.map((filter) => {
        const on = props.active === filter;
        const count = props.counts[filter];
        const blocked = on ? null : disabledReason(filter, count, props.viewer);
        const faces = facesFor(filter, props.viewer);
        const look = on ? 'bg-ink text-on-ink' : 'bg-surface text-ink shadow-control inset-ring inset-ring-edge-control-soft hover:bg-subtle disabled:opacity-50';
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={on}
            disabled={blocked !== null}
            title={blocked ?? (on ? 'Click again to show everything' : TITLES[filter])}
            onClick={() => props.onChange(on ? null : filter)}
            className={`flex h-6 min-w-0 items-center justify-center gap-1 rounded-full pr-2 text-[11px] font-semibold ${faces.length > 0 ? 'pl-[3px]' : 'pl-[9px]'} ${look}`}
          >
            {faces.length > 0 && (
              <span className="flex pl-1.5">
                {faces.map((login) => (
                  <span key={login} className="-ml-1.5 rounded-full">
                    <Avatar login={login} className={`ring-[1.5px] ${on ? 'ring-ink' : 'ring-surface'}`} />
                  </span>
                ))}
              </span>
            )}
            {LABELS[filter]}
            <span className={`font-mono text-[10px] font-medium tabular-nums ${on ? 'opacity-75' : 'text-hint'}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
