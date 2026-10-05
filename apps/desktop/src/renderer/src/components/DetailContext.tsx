import type { ReactNode } from 'react';
import type { TileView } from '@postpile/core';
import { stackQueueWord } from '../lib/pr.ts';
import { stackPlaces } from '../lib/stacks.ts';
import { kindParts, sameForWhom } from '../lib/tiles.ts';
import { BackIcon, ForwardIcon, KindIcon } from './icons.tsx';
import { PrRow } from './PrRow.tsx';

interface DetailContextProps {
  view: TileView;
  prKey: string;
  onSelectPr: (prKey: string) => void;
  /** Mark read, Snooze and ⋯ for the selected PR, quiet at the end of the first line (`PaneHousekeeping`). */
  housekeeping: ReactNode;
}

function NavButton(props: { back: boolean; ariaLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      onClick={props.onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-ink-2 shadow-control inset-ring inset-ring-edge-control-soft hover:bg-subtle"
    >
      {props.back ? <BackIcon size={13} /> : <ForwardIcon size={13} />}
    </button>
  );
}

/** "PR 1 of 2" with the digits in mono. */
function PrCounter(props: { index: number; count: number }) {
  const digit = 'font-mono text-[10.5px] font-semibold text-ink-2 tabular-nums';
  return (
    <span className="ml-auto flex shrink-0 items-baseline gap-1 text-[11px] whitespace-nowrap text-hint">
      PR <span className={digit}>{props.index + 1}</span> of <span className={digit}>{props.count}</span>
    </span>
  );
}

/**
 * Tinted header that repeats the selected tile. Several PRs: kind, title,
 * "PR x of n" with arrows, and the PR list: the tile's own `PrRow`s, so both
 * show the same facts on the same grid. One PR: just the kind; the title is right below in the
 * body, and a counter or arrows would lead nowhere.
 */
export function DetailContext(props: DetailContextProps) {
  const { view } = props;
  const count = view.prs.length;
  const several = count > 1;
  const places = stackPlaces(view.tile.stacks);
  const now = new Date();
  const kind = kindParts(view);
  const index = Math.max(
    view.prs.findIndex((pr) => pr.key === props.prKey),
    0,
  );

  function step(delta: number) {
    const next = view.prs[(index + delta + count) % count];
    if (next) {
      props.onSelectPr(next.key);
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 bg-detail-context px-[22px] pt-3.5 pb-3 shadow-[inset_0_-1px_0_var(--line-detail-context),inset_1px_0_0_var(--hairline-strong)]">
      {/* Starts on the 34px text line; the kind icon sits centered in a 20px slot. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3">
        <span className="flex shrink-0 items-center gap-2 text-[12.5px] font-semibold whitespace-nowrap text-accent">
          <KindIcon kind={view.tile.kind} size={14} className="mx-[3px] shrink-0" />
          {kind.word}
          {kind.count !== null && (
            <>
              <span className="text-set-sep">·</span>
              <span className="font-mono text-[11px] font-semibold tabular-nums">{kind.count}</span>
            </>
          )}
        </span>
        {several && (
          <>
            <span className="min-w-0 truncate text-[12.5px] text-ink-2">{view.tile.title}</span>
            <PrCounter index={index} count={count} />
            <span className="flex shrink-0 gap-1">
              <NavButton back ariaLabel="Previous PR in this tile" onClick={() => step(-1)} />
              <NavButton back={false} ariaLabel="Next PR in this tile" onClick={() => step(1)} />
            </span>
          </>
        )}
        <span className={several ? 'ml-1' : 'ml-auto'}>{props.housekeeping}</span>
      </div>
      {several && (
        // A container, so PrRow can drop its least needed facts when the pane is narrow.
        <div className="@container flex flex-col gap-0.5">
          {view.prs.map((pr) => (
            <PrRow
              key={pr.key}
              pr={pr}
              place="detail"
              grouped
              showForWhom={!sameForWhom(pr.forWhom, view.forWhom)}
              stackPlace={places.get(pr.key) ?? null}
              stackQueue={stackQueueWord(pr.key, view.prs, view.tile.stacks, now)}
              showTitle
              unread={view.unreadPrKeys.includes(pr.key)}
              selected={pr.key === props.prKey}
              greyed={false}
              onClick={() => props.onSelectPr(pr.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
