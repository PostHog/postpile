import { useEffect, useState, type ReactNode } from 'react';
import {
  cleanupDialogSetup,
  cleanupOption,
  MERGED_PICKS,
  OLDER_PICKS,
  type CleanupAge,
  type CleanupDialogMode,
  type CleanupPicks,
  type InboxCleanupView,
  type MergedPick,
} from '@postpile/core';
import { CLEANUP_BUSY, useActions } from '../api/actions.tsx';
import {
  dialogLead,
  dialogTitle,
  MERGED_PICK_LABELS,
  mergedCount,
  mergedNote,
  mergedPickBlocked,
  savingCounts,
  timingText,
} from '../lib/cleanup.ts';
import { Button } from './Button.tsx';
import { BellIcon, MergeIcon, TrashIcon } from './icons.tsx';

/** A merged card and a PR card hopping into a trash can whose lid tips. Still under prefers-reduced-motion. */
function CleanupArt() {
  return (
    <svg viewBox="0 0 96 64" className="h-[72px] w-[108px] shrink-0" aria-hidden="true">
      <path d="M30 40 C 40 52, 54 54, 62 44" fill="none" stroke="var(--ghost)" strokeWidth="1.3" strokeDasharray="2.5 3" strokeLinecap="round" />
      <g className="motion-safe:animate-cleanup-bob" style={{ transformOrigin: '22px 24px' }}>
        <g transform="rotate(-10 22 24)">
          <rect x="8" y="12" width="28" height="22" rx="5" fill="var(--merged-soft)" stroke="var(--merged)" strokeOpacity="0.35" />
          <g transform="translate(14 15)" className="text-merged">
            <MergeIcon size={16} />
          </g>
        </g>
      </g>
      <g className="motion-safe:animate-cleanup-bob [animation-delay:-1.6s]" style={{ transformOrigin: '44px 14px' }}>
        <g transform="rotate(8 44 14)">
          <rect x="32" y="4" width="24" height="19" rx="4.5" fill="var(--open-soft)" stroke="var(--open)" strokeOpacity="0.3" />
          <g transform="translate(37 6.5) scale(0.875)" fill="none" stroke="var(--open)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="4.5" cy="3.5" r="1.7" />
            <circle cx="4.5" cy="12.5" r="1.7" />
            <circle cx="11.5" cy="12.5" r="1.7" />
            <path d="M4.5 5.2v5.6M11.5 10.8V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
          </g>
        </g>
      </g>
      <rect x="60" y="31" width="26" height="27" rx="4" fill="var(--bg-segment)" />
      <path d="M66 36.5v16M73 36.5v16M80 36.5v16" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" />
      <g className="motion-safe:animate-cleanup-lid" style={{ transformOrigin: '68px 27px' }}>
        <rect x="57" y="26" width="32" height="5" rx="2.5" fill="var(--ink-2)" />
        <rect x="69" y="22.5" width="8" height="4" rx="1.5" fill="var(--ink-2)" />
      </g>
    </svg>
  );
}

interface SegmentOption<T> {
  value: T;
  label: string;
  /** Why it cannot be picked; null when it can. */
  blocked: string | null;
}

function Segmented<T extends string | number>(props: { label: string; options: SegmentOption<T>[]; value: T; on: boolean; onPick: (value: T) => void }) {
  return (
    <span role="group" aria-label={props.label} className={`inline-flex gap-0.5 rounded-control bg-segment p-0.5 ${props.on ? '' : 'opacity-55'}`}>
      {props.options.map((option) => {
        const picked = props.on && option.value === props.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={picked}
            disabled={option.blocked !== null}
            title={option.blocked ?? undefined}
            onClick={() => props.onPick(option.value)}
            className={`h-[22px] rounded-[5px] px-2 text-[11.5px] whitespace-nowrap disabled:text-ghost ${
              picked ? 'bg-surface font-medium text-ink shadow-segment' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

function PickRow(props: { on: boolean; onToggle: (on: boolean) => void; icon: ReactNode; label: string; count: number; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1 rounded-row px-3 py-2.5 inset-ring ${props.on ? 'bg-accent-soft inset-ring-accent-line' : 'inset-ring-hairline-strong'}`}>
      <input type="checkbox" checked={props.on} onChange={(event) => props.onToggle(event.target.checked)} aria-label={props.label} className="size-3.5 accent-[var(--accent)]" />
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink">
        {props.icon}
        {props.label}
      </span>
      <span className={`text-right font-mono text-xs font-semibold tabular-nums ${props.on ? 'text-ink-2' : 'text-faint'}`}>{props.count}</span>
      <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">{props.children}</div>
    </div>
  );
}

/**
 * The inbox catch-up dialog (DESIGN.md "Inbox cleanup"): on start, when the
 * server holds the sync for it (`mode` is the case), or from the sidebar
 * line. Two rows to combine: merged PRs (quiet 7+ / 14+ days or all) and
 * everything else with no activity for 14 / 30 days. Clear runs in the
 * background on the server (one pending write while locked). On start,
 * "Start as usual", Esc and a click outside answer it too, and the held
 * sync goes on either way.
 */
export function InboxCleanupDialog(props: { mode: CleanupDialogMode; view: InboxCleanupView; onClose: () => void }) {
  const actions = useActions();
  const { mode, view, onClose } = props;
  const sidebar = mode.kind === 'sidebar';
  // Picked once, from the counts when the dialog opened; later refetches leave the user's choice alone.
  const [setup] = useState(() => cleanupDialogSetup(mode, view.counts));
  const [mergedPick, setMergedPick] = useState<MergedPick>(setup.picks.merged ?? 'all');
  const [mergedOn, setMergedOn] = useState(setup.picks.merged !== null);
  const [olderPick, setOlderPick] = useState<CleanupAge>(setup.picks.older ?? 14);
  const [olderOn, setOlderOn] = useState(setup.picks.older !== null);
  const picks: CleanupPicks = { merged: mergedOn ? mergedPick : null, older: olderOn ? olderPick : null };
  const option = cleanupOption(view.options, picks);
  const clears = option?.clears ?? 0;
  const locked = actions.writes?.enabled !== true;
  const busy = actions.isBusy(CLEANUP_BUSY.clear) || actions.isBusy(CLEANUP_BUSY.start);
  const saving = setup.saving ? savingCounts(view, option) : null;
  const mainIsClear = sidebar || setup.main === 'clear';

  async function clear() {
    if (clears > 0 && (await actions.clearInbox({ ...picks, countedAt: view.countedAt, from: sidebar ? 'sidebar' : 'start' }))) {
      onClose();
    }
  }

  async function startAsUsual() {
    if (await actions.startAsUsual()) {
      onClose();
    }
  }

  // On start every way out answers the dialog; from the sidebar it just closes.
  const dismiss = sidebar ? onClose : () => void startAsUsual();
  const main = mainIsClear ? () => void clear() : dismiss;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
      }
      // A focused button or checkbox takes Enter itself.
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement)) {
        main();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const clearButton = (
    <Button variant={mainIsClear ? 'primary' : 'secondary'} size="md" disabled={busy || clears === 0} title={actions.blockedReason('cleanup') ?? undefined} onClick={() => void clear()}>
      <TrashIcon />
      {locked ? 'Add pending write' : `Clear ${clears}`}
      {setup.recommended && <span className="rounded-full bg-safe-soft px-1.5 text-[10px] leading-[17px] font-semibold text-safe">Recommended</span>}
      {mainIsClear && !sidebar && <span className="font-mono text-[10px] opacity-60">⏎</span>}
    </Button>
  );
  const startButton = (
    <Button variant={mainIsClear ? 'secondary' : 'primary'} size="md" disabled={busy} onClick={() => void startAsUsual()}>
      Start as usual
      {!mainIsClear && <span className="font-mono text-[10px] opacity-60">⏎</span>}
    </Button>
  );
  const mergedOptions = MERGED_PICKS.map((pick) => ({ value: pick, label: MERGED_PICK_LABELS[pick], blocked: mergedPickBlocked(pick, view.counts) }));
  const olderOptions = OLDER_PICKS.map((age) => ({ value: age, label: `${age} days`, blocked: null }));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-4" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div role="dialog" aria-modal="true" aria-labelledby="cleanup-title" className="flex w-[540px] max-w-full flex-col gap-3.5 rounded-tile bg-surface px-[22px] pt-5 pb-[18px] shadow-menu">
        <div className="flex items-center gap-4">
          <CleanupArt />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="cleanup-title" className="text-[15.5px] font-semibold tracking-[-0.01em] text-ink">
              {dialogTitle(mode)}
            </h2>
            <p className="text-[12.5px] leading-normal text-ink-2">
              {dialogLead(mode, view.counts).map((part, index) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <span key={index} className="font-mono font-semibold text-ink tabular-nums">
                    {part.count}
                  </span>
                ),
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1 rounded-row bg-window px-3 py-2.5 text-xs leading-relaxed text-ink-2">
          <p>Keeping them is fine: a merged PR asks nothing of you and never pings you. PostPile shows what needs you first; these stay unread until you get to them.</p>
          <p>Clearing marks them read on GitHub, so your GitHub inbox shrinks too and finished topics move to the Archive.</p>
        </div>
        {saving && (
          <p className="flex items-start gap-2 rounded-row bg-safe-soft px-3 py-2 text-xs leading-normal text-safe">
            <span aria-hidden="true">✨</span>
            <span>
              Clearing first means the agent reads <b className="font-semibold">{saving.after} PRs</b> instead of {saving.before}.
            </span>
          </p>
        )}
        {view.pending && <p className="rounded-row bg-subtle px-3 py-2 text-[11.5px] text-ink-2">A cleanup already waits in the lock.</p>}
        <div className="flex flex-col gap-1.5">
          <PickRow on={mergedOn} onToggle={setMergedOn} icon={<MergeIcon className="text-merged" />} label="Merged PRs" count={mergedCount(mergedPick, view.counts)}>
            <Segmented
              label="Which merged PRs"
              options={mergedOptions}
              value={mergedPick}
              on={mergedOn}
              onPick={(pick) => {
                setMergedPick(pick);
                setMergedOn(true);
              }}
            />
            <span className="text-[11px] text-muted">{mergedNote(mergedPick, view.counts)}</span>
          </PickRow>
          <PickRow
            on={olderOn}
            onToggle={setOlderOn}
            icon={
              <span className="text-muted">
                <BellIcon />
              </span>
            }
            label="Everything else, no activity for"
            count={olderPick === 30 ? view.counts.olderThan30 : view.counts.olderThan14}
          >
            <Segmented
              label="How old"
              options={olderOptions}
              value={olderPick}
              on={olderOn}
              onPick={(age) => {
                setOlderPick(age);
                setOlderOn(true);
              }}
            />
            <span className="text-[11px] text-muted">Issues, discussions, open PRs. One call to GitHub.</span>
          </PickRow>
        </div>
        <p className="text-[11px] leading-snug text-hint">{timingText(option, locked, sidebar)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {sidebar ? (
            <>
              <span className="grow" />
              <Button size="md" onClick={onClose}>
                Cancel
              </Button>
              {clearButton}
            </>
          ) : mainIsClear ? (
            <>
              {startButton}
              <span className="grow" />
              {clearButton}
            </>
          ) : (
            <>
              <span className="grow" />
              {clearButton}
              {startButton}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
