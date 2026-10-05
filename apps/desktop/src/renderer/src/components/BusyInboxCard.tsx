import { useState } from 'react';
import type { BusyInboxView } from '@postpile/core';
import { useBusyInbox } from '../api/busy-inbox.ts';
import { useInboxCleanup } from '../api/cleanup.ts';
import { cleanUpBlocked, collapsedText, countText, keptTiers, leadParts, whyLines } from '../lib/busy-inbox.ts';
import { BusyInboxArt } from './BusyInboxArt.tsx';
import { ChevronIcon } from './icons.tsx';
import { InboxCleanupDialog } from './InboxCleanupDialog.tsx';

/** sessionStorage key: the card folded to one line. Lasts for this window's session, never across launches. */
export const BUSY_CARD_FOLDED_KEY = 'postpile.busyInbox.folded';

function readFolded(): boolean {
  try {
    return window.sessionStorage.getItem(BUSY_CARD_FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeFolded(folded: boolean): void {
  try {
    if (folded) {
      window.sessionStorage.setItem(BUSY_CARD_FOLDED_KEY, '1');
    } else {
      window.sessionStorage.removeItem(BUSY_CARD_FOLDED_KEY);
    }
  } catch {
    // Storage can be blocked; the fold then lasts until the card remounts.
  }
}

/** The card's text links: amber ink like the card, a soft underline, ink on hover. */
const LINK =
  'underline decoration-amber-ink/30 underline-offset-2 hover:text-ink hover:decoration-current disabled:no-underline disabled:opacity-55 disabled:hover:text-amber-ink';

/** Folded: one quiet line with the small robot, standing still. A click opens the card again. */
function FoldedLine(props: { view: BusyInboxView; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={props.onOpen}
      title="Show the busy inbox card"
      className="flex min-w-0 items-center gap-2 rounded-row bg-amber-soft py-1 pr-2.5 pl-2 text-left text-[11.5px] leading-[normal] text-amber-ink inset-ring inset-ring-amber-line hover:text-ink"
    >
      <BusyInboxArt size="line" />
      <span className="min-w-0 flex-1 truncate font-medium">{collapsedText(props.view)}</span>
      <span className="flex shrink-0 -rotate-90">
        <ChevronIcon />
      </span>
    </button>
  );
}

/** "Kept 940 for you · 560 for your team · 0 for others": what the board holds per tier. A wrapped line starts with a number, never a dot. */
function KeptLine(props: { view: BusyInboxView }) {
  const tiers = keptTiers(props.view);
  return (
    <span className="flex flex-wrap gap-x-1 text-[11px] leading-[1.4]">
      <span>Kept</span>
      {tiers.map((tier, index) => (
        <span key={tier.label} className="whitespace-nowrap">
          <span className="font-mono text-[10.5px] font-semibold tabular-nums">{countText(tier.count)}</span> {tier.label}
          {index < tiers.length - 1 && <span className="pl-1 opacity-50">·</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * The busy inbox card at the top of the sidebar, right above the topics:
 * the place where topics go missing when the board cap cuts the inbox
 * (DESIGN.md "Big inboxes: what PostPile loads and works on"). Only while
 * `busy`. Calm amber, never coral or honey: PostPile is focusing, nothing
 * broke. Clean up opens the inbox cleanup dialog, Why? says what PostPile
 * does now. It folds to one line for the session. No GitHub writes lock
 * here: the footer is the only place for it (2026-10-05).
 */
export function BusyInboxCard() {
  const view = useBusyInbox().data;
  const cleanup = useInboxCleanup().data;
  const [folded, setFolded] = useState(readFolded);
  const [whyOpen, setWhyOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  if (!view?.busy) {
    return null;
  }
  const fold = (next: boolean) => {
    setFolded(next);
    storeFolded(next);
  };
  if (folded) {
    return <FoldedLine view={view} onOpen={() => fold(false)} />;
  }
  const blocked = cleanUpBlocked(cleanup);
  return (
    <section aria-labelledby="busy-inbox-title" className="@container flex flex-col gap-2 rounded-box bg-amber-soft px-3 py-[11px] text-amber-ink inset-ring inset-ring-amber-line">
      <div className="flex items-center gap-2.5">
        <BusyInboxArt size="card" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1">
            <strong id="busy-inbox-title" className="text-[13px] leading-[normal] font-[650]">
              Busy inbox
            </strong>
            <button
              type="button"
              aria-expanded={true}
              aria-label="Fold the busy inbox card"
              title="Fold to one line for this session"
              onClick={() => fold(true)}
              className="-mr-1 ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-70 hover:text-ink hover:opacity-100"
            >
              <span className="flex rotate-180">
                <ChevronIcon />
              </span>
            </button>
          </span>
          <span className="text-[11.5px] leading-[1.4]">
            {leadParts(view).map((part, index) =>
              typeof part === 'string' ? (
                part
              ) : (
                <span key={index} className="font-mono text-[11px] tabular-nums">
                  {countText(part.count)}
                </span>
              ),
            )}
          </span>
          <KeptLine view={view} />
        </span>
      </div>
      {/* With room, the links and Why? start under the text (robot 40px + gap); on a narrow sidebar they take the full width. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] leading-[normal] @min-[220px]:pl-[50px]">
        <button type="button" disabled={blocked !== null} title={blocked ?? 'Mark merged PRs and old notifications read on GitHub'} onClick={() => setCleanupOpen(true)} className={LINK}>
          Clean up
        </button>
        <button type="button" aria-expanded={whyOpen} aria-controls="busy-inbox-why" onClick={() => setWhyOpen(!whyOpen)} className={LINK}>
          Why?
        </button>
      </div>
      {whyOpen && (
        <ul id="busy-inbox-why" className="flex flex-col gap-1 text-[11.5px] leading-[1.45] @min-[220px]:pl-[50px]">
          {whyLines(view).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {cleanupOpen && cleanup && <InboxCleanupDialog mode={{ kind: 'sidebar' }} view={cleanup} onClose={() => setCleanupOpen(false)} />}
    </section>
  );
}
