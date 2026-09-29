import type { TileView } from '@postpile/core';
import { LIFECYCLE_WORDS, rowStateWord } from '../lib/pr.ts';
import { kindLabel, prNumber, sameForWhom } from '../lib/tiles.ts';
import { BackIcon, ForwardIcon, KindIcon, PrStateIcon } from './icons.tsx';
import { ForWhomChip, StateWordLabel } from './pills.tsx';

interface DetailContextProps {
  view: TileView;
  prKey: string;
  onSelectPr: (prKey: string) => void;
}

function NavButton(props: { back: boolean; ariaLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      onClick={props.onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-frame bg-surface text-ink-2 hover:bg-subtle"
    >
      {props.back ? <BackIcon /> : <ForwardIcon />}
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
        <span className="flex shrink-0 items-center gap-[5px] text-[12.5px] font-semibold whitespace-nowrap text-accent">
          <KindIcon kind={view.tile.kind} size={14} />
          {kindLabel(view)}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-ink-2">{view.tile.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] whitespace-nowrap text-muted">
          PR {index + 1} of {count}
        </span>
        <NavButton back ariaLabel="Previous PR in this tile" onClick={() => step(-1)} />
        <NavButton back={false} ariaLabel="Next PR in this tile" onClick={() => step(1)} />
      </div>
      {count > 1 && (
        <div className="flex flex-col gap-1">
          {view.prs.map((pr) => {
            const picked = pr.key === props.prKey;
            const lifecycle = pr.status.lifecycle;
            const quiet = lifecycle === 'draft' || lifecycle === 'closed';
            const word = rowStateWord(pr.status);
            let look = 'border-transparent hover:bg-surface/70';
            let titleLook = 'font-medium text-ink';
            if (picked) {
              look = 'border-accent bg-surface shadow-picked';
              titleLook = 'font-semibold text-ink';
            } else if (quiet) {
              look = 'border-transparent bg-segment hover:bg-chip';
              titleLook = 'font-medium text-muted';
            }
            return (
              <button
                key={pr.key}
                type="button"
                onClick={() => props.onSelectPr(pr.key)}
                className={`flex h-8 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-[12.5px] focus-visible:-outline-offset-2 ${look}`}
              >
                <PrStateIcon lifecycle={lifecycle} title={LIFECYCLE_WORDS[lifecycle].title} />
                <span className={`shrink-0 font-mono text-[11px] ${quiet && !picked ? 'text-faint' : 'text-ink-2'}`}>#{prNumber(pr.key)}</span>
                <span className={`min-w-0 truncate ${titleLook}`}>{pr.title}</span>
                {!sameForWhom(pr.forWhom, view.forWhom) && <ForWhomChip forWhom={pr.forWhom} code={pr.why} provenance={pr.provenance} size="row" />}
                <span className="ml-auto flex shrink-0 items-center pl-1">{word && <StateWordLabel word={word} />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
