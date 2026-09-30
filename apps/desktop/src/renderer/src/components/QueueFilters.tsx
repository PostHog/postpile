import type { ViewerView } from '@postpile/core';
import { visibleQueueFilters, type QueueFilter } from '../lib/queues.ts';
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

/** The pill buttons above the sections; one filter at a time. Two by two when the sidebar is narrow. */
export function QueueFilters(props: QueueFiltersProps) {
  return (
    <div className="grid grid-cols-2 gap-1 @min-[290px]:flex @min-[290px]:flex-wrap" role="group" aria-label="Filter topics">
      {visibleQueueFilters(props.viewer?.homeTeams, props.active).map((filter) => {
        const on = props.active === filter;
        const count = props.counts[filter];
        const blocked = on ? null : disabledReason(filter, count, props.viewer);
        const faces = facesFor(filter, props.viewer);
        const look = on ? 'border-ink bg-ink text-on-ink' : 'border-frame bg-surface text-ink hover:border-control disabled:opacity-50';
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={on}
            disabled={blocked !== null}
            title={blocked ?? (on ? 'Click again to show everything' : TITLES[filter])}
            onClick={() => props.onChange(on ? null : filter)}
            className={`flex h-[26px] items-center justify-center gap-1 rounded-full border text-[11px] font-semibold ${faces.length > 0 ? 'pr-2 pl-[3px]' : 'px-2'} ${look}`}
          >
            {faces.length > 0 && (
              <span className="flex pl-[7px]">
                {faces.map((login) => (
                  <span key={login} className="-ml-[7px] rounded-full">
                    <Avatar login={login} className={`ring-2 ${on ? 'ring-ink' : 'ring-surface'}`} />
                  </span>
                ))}
              </span>
            )}
            {LABELS[filter]}
            <span className="font-mono text-[10px] font-medium opacity-75">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
