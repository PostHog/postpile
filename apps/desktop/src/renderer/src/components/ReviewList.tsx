import type { PrPaneView } from '@postpile/core';
import type { EventGlyph } from '../lib/events.ts';
import { reviewRows, type ReviewStatus } from '../lib/pr.ts';
import { isTeam } from '../lib/people.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Avatar } from './Avatar.tsx';
import { Glyph } from './icons.tsx';
import { SectionLabel } from './SectionLabel.tsx';

// Same glyphs and soft tints as the tile's status pill and event badges.
const STATUS: Record<ReviewStatus, { label: string; badge: string; glyph: EventGlyph }> = {
  requested: { label: 'review requested', badge: 'bg-quiet-soft text-muted', glyph: 'eye' },
  approved: { label: 'approved', badge: 'bg-safe-soft text-safe', glyph: 'check' },
  changes_requested: { label: 'requested changes', badge: 'bg-status-bad-soft text-status-bad', glyph: 'changes' },
  commented: { label: 'commented', badge: 'bg-quiet-soft text-muted', glyph: 'bubble' },
  dismissed: { label: 'dismissed', badge: 'bg-quiet-soft text-faint', glyph: 'eye' },
};

/** Who reviewed, who still has to. */
export function ReviewList(props: { pr: PrPaneView }) {
  const now = useNow();
  const rows = reviewRows(props.pr);
  return (
    <div className="flex flex-col gap-1.5 px-3">
      <SectionLabel>Reviews</SectionLabel>
      {rows.length === 0 && <span className="text-xs text-hint">No reviews or requests yet.</span>}
      {rows.length > 0 && (
        <div className="flex flex-col gap-1 pt-0.5">
          {rows.map((row) => {
            const status = STATUS[row.status];
            const label = row.status === 'requested' && isTeam(row.login) ? 'waiting · team' : status.label;
            return (
              <div key={row.login} className="grid min-h-[26px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2">
                <span className="relative flex">
                  <Avatar login={row.login} size="mid" />
                  <span className={`absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full ring-[1.5px] ring-surface ${status.badge}`}>
                    <Glyph glyph={status.glyph} size={7} strokeWidth={2.6} />
                  </span>
                </span>
                <span className="truncate text-[12.5px]">
                  <span className="font-medium">{row.login}</span> <span className="text-hint">{label}</span>
                </span>
                <span className="text-right font-mono text-[10.5px] text-faint tabular-nums">{row.at ? ageLabel(row.at, now) : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
