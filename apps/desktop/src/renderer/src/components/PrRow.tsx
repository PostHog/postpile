import type { PrSummary } from '@code-manager/core';
import { prLook } from '../lib/pr.ts';
import { prNumber } from '../lib/tiles.ts';
import { Avatar } from './Avatar.tsx';
import { PrIcon } from './icons.tsx';
import { lookIconTone, ProvenanceTag } from './pills.tsx';

interface PrRowProps {
  pr: PrSummary;
  /** This PR is open in the detail pane. */
  selected: boolean;
  /** The PR the tile is unread about; drawn a little stronger. */
  strong: boolean;
  first: boolean;
  onClick: () => void;
}

/** One PR line inside a tile: state icon, number, title, provenance, author. */
export function PrRow(props: PrRowProps) {
  const { pr } = props;
  let background = 'bg-surface hover:bg-subtle';
  if (props.selected) {
    background = 'bg-accent-row';
  } else if (props.strong) {
    background = 'bg-unread-row hover:bg-subtle';
  }
  const weight = props.selected || props.strong ? 'font-semibold' : 'font-[450]';
  const titleTone = pr.provenance.kind === 'pulled_in' && !props.selected ? 'text-ink-2' : 'text-ink';
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={`grid h-[30px] grid-cols-[14px_50px_minmax(0,1fr)_auto_auto_12px] items-center gap-2 px-2.5 text-left text-xs ${
        props.first ? '' : 'border-t border-hairline-soft'
      } ${background}`}
    >
      <span className={lookIconTone(prLook(pr))}>
        <PrIcon size={12} strokeWidth={1.7} />
      </span>
      <span className={`font-mono text-[10.5px] ${props.selected ? 'text-accent' : 'text-muted'}`}>#{prNumber(pr.key)}</span>
      <span className={`truncate ${weight} ${titleTone}`}>{pr.title}</span>
      <ProvenanceTag provenance={pr.provenance} />
      <Avatar login={pr.author} className="ring-[1.5px] ring-surface" />
      <span className={`text-xs font-bold ${props.selected ? 'text-accent' : 'text-ghost'}`}>{props.selected ? '→' : '›'}</span>
    </button>
  );
}
