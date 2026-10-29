import type { TileView } from '@postpile/core';
import { filesTabUrl } from '../lib/key-files.ts';
import { scoutTilePrKey } from '../lib/scouts.ts';
import { buttonClasses } from './Button.tsx';
import { ExternalIcon } from './icons.tsx';
import { ScoutActions } from './ScoutActions.tsx';
import { TurnLine } from './TurnLine.tsx';

/**
 * A scout tile's footer (DESIGN.md "Scouts"): whose turn on GitHub when it
 * is someone's (never "Your move": a scouted PR is not the user's work until
 * they follow it), then Follow and Dismiss, and the GitHub link. No Mark
 * read, Snooze, Approve or ⋯ menu: a scouted PR has no thread to read, no
 * review asked of the user, and no topic to move it from.
 */
export function ScoutTileFooter(props: { view: TileView; selectedPrKey: string | null; done: boolean }) {
  const { view } = props;
  const scout = view.scout;
  const prKey = scout ? scoutTilePrKey(view, props.selectedPrKey) : null;
  const github = view.offers.github;
  return (
    <div className={`mt-auto flex min-h-[46px] flex-wrap items-center gap-x-2 gap-y-1.5 rounded-b-tile py-1.5 pr-3.5 pl-[15px] ${props.done ? 'shadow-[inset_0_1px_0_var(--hairline-done)]' : 'shadow-[inset_0_1px_0_var(--hairline-soft)]'}`}>
      <div className="@container flex min-w-0 flex-1 basis-0">{view.turn.kind !== 'you' && <TurnLine turn={view.turn} greyed={props.done} />}</div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {scout && prKey && <ScoutActions followPrKey={prKey} dismissPrKeys={scout.prKeys} follow={scout.follow} from="tile" up />}
        {github && (
          <a href={github.filesTab ? filesTabUrl(github.url) : github.url} target="_blank" rel="noreferrer" title="Opens the PR on github.com" className={`${buttonClasses('secondary', 'sm')} gap-[5px]`}>
            {github.label}
            <ExternalIcon size={10} className="text-faint" />
          </a>
        )}
      </div>
    </div>
  );
}
