import type { TileView } from '@postpile/core';
import { usePr } from '../api/pr.ts';
import { useGlanceLook } from '../lib/use-glance-look.ts';
import { paneOffersFor } from '../lib/pane-offers.ts';
import { DetailContext } from './DetailContext.tsx';
import { PaneHousekeeping } from './PaneHousekeeping.tsx';
import { PrBody } from './PrBody.tsx';

interface DetailPaneProps {
  view: TileView | null;
  prKey: string | null;
  onSelectPr: (prKey: string) => void;
  /** The line under "No tile selected". */
  noSelectionText: string;
}

// The left edge is an inset shadow, not a border, so the 22 / 34 / 62 keylines count from the pane's own edge.
const paneFrame = 'flex min-h-0 flex-col bg-surface shadow-[inset_1px_0_0_var(--hairline-strong)]';

/**
 * Right pane: the selected tile's context header (with the quiet
 * housekeeping: mark read, snooze, ⋯), then one of its PRs in full. Talking
 * to the agent is not here: "Ask the agent" on the topic takes this column
 * over (`AgentPane`).
 */
export function DetailPane(props: DetailPaneProps) {
  const pr = usePr(props.prKey);
  // A stale glance on the PR open here is rewritten once it stayed open a moment (refresh on look).
  useGlanceLook(props.prKey, pr.data ?? null);

  if (!props.view || !props.prKey) {
    return (
      <aside aria-label="Details" className={`${paneFrame} items-center justify-center gap-1 px-8 text-center text-xs text-muted`}>
        <p className="font-medium text-ink-2">No tile selected</p>
        <p>{props.noSelectionText}</p>
      </aside>
    );
  }
  const view = props.view;
  const prKey = props.prKey;
  const summary = view.prs.find((candidate) => candidate.key === prKey) ?? null;
  const offers = paneOffersFor(view, prKey);

  let body = <p className="flex-1 px-[22px] py-[18px] text-xs text-muted">Loading {prKey}…</p>;
  if (pr.error) {
    body = <p className="flex-1 px-[22px] py-[18px] text-xs text-status-bad">Could not load {prKey}: {pr.error.message}</p>;
  } else if (pr.data) {
    // Keyed by PR, once for the whole body: the composer, folded boxes and scroll start fresh per PR.
    // Don't key the body's children by PR as well: siblings with one key make React leave stale copies in the DOM.
    body = <PrBody key={prKey} detail={pr.data} summary={summary} view={view} offers={offers} />;
  }

  return (
    <aside aria-label="Details" className={paneFrame}>
      <DetailContext view={view} prKey={prKey} onSelectPr={props.onSelectPr} housekeeping={<PaneHousekeeping view={view} prKey={prKey} offers={offers} />} />
      {body}
    </aside>
  );
}
