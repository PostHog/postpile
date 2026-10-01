import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MarkLabel, PrKey, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { opensMarkRead, OpenedReadTimer, type OpenedReadPhase } from './opened-read.ts';

/** The open marked the PR: which label the button had ("Mark read" or "Done for now"), and whether Undo is still offered. */
export interface OpenedMark {
  label: MarkLabel;
  canUndo: boolean;
}

/**
 * What the detail pane shows of the automatic mark for the PR in the pane:
 * `filling` while the dwell runs (and while the mark is on its way), `marked`
 * once the open marked it ("✓ Marked read" with Undo), null otherwise.
 */
export interface OpenedReadState {
  prKey: PrKey | null;
  filling: boolean;
  marked: OpenedMark | null;
  undo(): void;
}

export const OpenedReadContext = createContext<OpenedReadState>({ prKey: null, filling: false, marked: null, undo: () => {} });

export function useOpenedReadState(): OpenedReadState {
  return useContext(OpenedReadContext);
}

/**
 * Marks the PR in the detail pane read on GitHub (and handled in PostPile)
 * when it stayed open for OPENED_READ_DELAY_MS while the window was visible
 * and `opensMarkRead` says so ("Marked when the dwell ends", 2026-10-01).
 * The mark goes out when the dwell ends, while the PR is still on screen; the
 * tile and its topic row keep their place until the selection moves
 * (`useHeldPlace`). Once per open (`OpenedReadTimer`): re-renders and
 * refetches of the same PR ask nothing more, and opening the PR again later
 * asks again (the server turns that into a no-op once it is done). Undo
 * takes the mark back through the mark-read undo window.
 */
export function useOpenedRead(view: TileView | null, prKey: PrKey | null): OpenedReadState {
  const actions = useActions();
  const wanted = opensMarkRead(view, prKey, actions.writes);
  // The provider hands out new functions on every render; the timer calls the latest ones.
  const latest = useRef(actions);
  latest.current = actions;
  // The label the button showed when the dwell ended: once the PR is done, core offers no mark button any more.
  const label = useRef<MarkLabel>('Mark read');
  const paneLabel = prKey === null ? null : (view?.offers.pane[prKey]?.markLabel ?? null);
  if (paneLabel !== null) {
    label.current = paneLabel;
  }
  const [markedLabel, setMarkedLabel] = useState<MarkLabel>('Mark read');
  const timer = useRef<OpenedReadTimer | null>(null);
  const [phase, setPhase] = useState<OpenedReadPhase>('idle');

  useEffect(() => {
    if (prKey === null) {
      return;
    }
    const markOpened = () => {
      setMarkedLabel(label.current);
      return latest.current.markOpenedRead(prKey);
    };
    const open = new OpenedReadTimer(markOpened, window, setPhase);
    timer.current = open;
    setPhase('idle');
    // Visibility only counts for the dwell; once it is over, leaving the app changes nothing.
    const onVisibility = () => (document.visibilityState === 'visible' && document.hasFocus() ? open.visible() : open.hidden());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
      window.removeEventListener('focus', onVisibility);
      open.leave();
      timer.current = null;
    };
  }, [prKey]);

  // Declared after the open's effect: on a PR change the new open exists before it gets its flag.
  useEffect(() => {
    timer.current?.setWanted(wanted);
  }, [wanted, prKey]);

  const marked = phase === 'marked' || phase === 'settled';
  return {
    prKey,
    filling: wanted && (phase === 'filling' || phase === 'sending'),
    marked: marked ? { label: markedLabel, canUndo: phase === 'marked' } : null,
    undo: () => {
      const token = timer.current?.undo() ?? null;
      if (token !== null) {
        void latest.current.undo(token);
      }
    },
  };
}
