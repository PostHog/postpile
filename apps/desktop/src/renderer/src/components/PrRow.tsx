import type { PrSummary } from '@code-manager/core';
import { prNumber } from '../lib/tiles.ts';
import { Avatar } from './Avatar.tsx';
import { Glyph } from './icons.tsx';
import { StatusPill, WhyBadge } from './pills.tsx';

interface PrRowProps {
  pr: PrSummary;
  /** This PR is open in the detail pane. */
  selected: boolean;
  /** The PR the tile is unread about; drawn a little stronger. */
  strong: boolean;
  /** Done tiles grey the why badge, the status pill and the thread count. */
  greyed: boolean;
  first: boolean;
  onClick: () => void;
}

/** One PR line inside a tile: why it's here, number, title, status pill, open threads, author. */
export function PrRow(props: PrRowProps) {
  const { pr } = props;
  const background = props.selected ? 'bg-accent-row' : 'bg-surface hover:bg-subtle';
  const weight = props.selected || props.strong ? 'font-semibold' : 'font-[450]';
  let titleTone = 'text-ink';
  if (props.greyed) {
    titleTone = 'text-muted';
  } else if (pr.provenance.kind === 'pulled_in' && !props.selected) {
    titleTone = 'text-ink-2';
  }
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={`grid h-8 grid-cols-[26px_44px_minmax(0,1fr)_auto_18px] items-center gap-[7px] px-[9px] text-left text-xs ${
        props.first ? '' : 'border-t border-hairline-soft'
      } ${background}`}
    >
      <WhyBadge code={pr.why} provenance={pr.provenance} greyed={props.greyed} size="row" />
      <span className={`font-mono text-[10.5px] ${props.selected ? 'text-accent' : 'text-muted'}`}>#{prNumber(pr.key)}</span>
      <span className={`truncate ${weight} ${titleTone}`}>{pr.title}</span>
      <span className="flex items-center gap-1">
        <StatusPill status={pr.status} greyed={props.greyed} />
        {pr.openThreads > 0 && (
          <span
            title={`${pr.openThreads} open review thread${pr.openThreads === 1 ? '' : 's'}`}
            className={`flex items-center gap-0.5 font-mono text-[10px] ${props.greyed ? 'text-faint' : 'text-muted'}`}
          >
            <Glyph glyph="bubble" size={10} strokeWidth={1.8} />
            {pr.openThreads}
          </span>
        )}
      </span>
      <Avatar login={pr.author} />
    </button>
  );
}
