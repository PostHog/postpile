import type { Pr } from '@postpile/core';
import type { EventGlyph } from '../lib/events.ts';
import { reviewRows, type ReviewStatus } from '../lib/pr.ts';
import { isTeam } from '../lib/people.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Avatar } from './Avatar.tsx';
import { Glyph } from './icons.tsx';

// Same glyphs and soft tints as the tile's status pill and event badges.
const STATUS: Record<ReviewStatus, { label: string; badge: string; glyph: EventGlyph }> = {
  requested: { label: 'review requested', badge: 'bg-quiet-soft text-muted', glyph: 'eye' },
  approved: { label: 'approved', badge: 'bg-status-good-soft text-status-good', glyph: 'check' },
  changes_requested: { label: 'requested changes', badge: 'bg-status-bad-soft text-status-bad', glyph: 'changes' },
  commented: { label: 'commented', badge: 'bg-quiet-soft text-muted', glyph: 'bubble' },
  dismissed: { label: 'dismissed', badge: 'bg-quiet-soft text-faint', glyph: 'eye' },
};

/** Who reviewed, who still has to. */
export function ReviewList(props: { pr: Pr }) {
  const now = useNow();
  const rows = reviewRows(props.pr);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-[0.04em] text-muted">Reviews</span>
      {rows.length === 0 && <span className="text-xs text-faint">No reviews or requests yet.</span>}
      {rows.map((row) => {
        const status = STATUS[row.status];
        const label = row.status === 'requested' && isTeam(row.login) ? 'waiting · team' : status.label;
        return (
          <div key={row.login} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2">
            <span className="relative">
              <Avatar login={row.login} size="md" />
              <span
                className={`absolute -right-1 -bottom-1 flex size-[13px] items-center justify-center rounded-full border-[1.5px] border-surface ${status.badge}`}
              >
                <Glyph glyph={status.glyph} size={7} />
              </span>
            </span>
            <span className="truncate text-[12.5px]">
              <span className="font-medium">{row.login}</span> <span className="text-muted">{label}</span>
            </span>
            <span className="font-mono text-[10.5px] text-faint">{row.at ? ageLabel(row.at, now) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
