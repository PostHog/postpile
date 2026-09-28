import type { TileView } from '@postpile/core';
import { kindLabel, prNumber } from '../lib/tiles.ts';
import { KindIcon } from './icons.tsx';
import { ForWhomChip, StatusPill } from './pills.tsx';

interface DetailContextProps {
  view: TileView;
  prKey: string;
  onSelectPr: (prKey: string) => void;
}

function NavButton(props: { label: string; ariaLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      className="size-6 shrink-0 rounded-md border border-frame bg-surface text-xs text-ink-2 hover:bg-subtle"
    >
      {props.label}
    </button>
  );
}

/** Tinted header that repeats the selected tile: kind, title, position, and its PRs. */
export function DetailContext(props: DetailContextProps) {
  const { view } = props;
  const count = view.prs.length;
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
    <div className="flex shrink-0 flex-col gap-2 border-b border-hairline bg-accent-soft px-[22px] pt-3.5 pb-3">
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center gap-[5px] text-[11px] font-semibold whitespace-nowrap text-accent">
          <KindIcon kind={view.tile.kind} />
          {kindLabel(view)}
        </span>
        <span className="min-w-0 truncate text-[11.5px] text-ink-2">{view.tile.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] whitespace-nowrap text-muted">
          PR {index + 1} of {count}
        </span>
        <NavButton label="‹" ariaLabel="Previous PR in this tile" onClick={() => step(-1)} />
        <NavButton label="›" ariaLabel="Next PR in this tile" onClick={() => step(1)} />
      </div>
      {count > 1 && (
        <div className="flex flex-col gap-0.5">
          {view.prs.map((pr) => {
            const picked = pr.key === props.prKey;
            return (
              <button
                key={pr.key}
                type="button"
                onClick={() => props.onSelectPr(pr.key)}
                className={`grid h-[26px] grid-cols-[46px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 text-left text-[11.5px] ${
                  picked ? 'bg-surface shadow-picked' : 'hover:bg-surface/60'
                }`}
              >
                <span className={`font-mono text-[10px] ${picked ? 'text-accent' : 'text-muted'}`}>#{prNumber(pr.key)}</span>
                <span className={`truncate ${picked ? 'font-semibold' : 'font-[450]'}`}>{pr.title}</span>
                <ForWhomChip forWhom={pr.forWhom} code={pr.why} provenance={pr.provenance} size="row" />
                <StatusPill status={pr.status} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
