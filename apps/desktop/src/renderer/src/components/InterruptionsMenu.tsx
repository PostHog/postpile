import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { InterruptionsMode } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useInterruptions } from '../api/interruptions.ts';
import { interruptionsMenuHint, interruptionsRowValue, interruptionsTitle, INTERRUPTIONS_ORDER } from '../lib/interruptions.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { BellIcon, BellOffIcon, CheckIcon, ChevronIcon } from './icons.tsx';

/** One mode in the menu: bold title and a one-line hint, a check on the current one. */
function ModeItem(props: { mode: InterruptionsMode; checked: boolean; roundupTimes: string[]; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.checked}
      onClick={props.onPick}
      className={`flex items-start gap-2 rounded-md p-2 text-left ${props.checked ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
    >
      <span className="mt-0.5 w-3.5 shrink-0 text-accent">{props.checked && <CheckIcon />}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-ink">{interruptionsTitle(props.mode)}</span>
        <span className="text-[11px] leading-[1.4] text-hint">{interruptionsMenuHint(props.mode, props.roundupTimes)}</span>
      </span>
    </button>
  );
}

/**
 * The sidebar footer's "Interruptions" row: when PostPile may show a Mac
 * notification, with the mode as a quiet word on the right. A click opens a
 * small menu above it with the three modes and "Send a test notification"
 * (desktop app only). Picking a mode saves it right away, without a toast.
 */
export function InterruptionsMenu() {
  const actions = useActions();
  const interruptions = useInterruptions();
  const view = interruptions.data;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  // Keyboard users land on the current mode when the menu opens.
  useEffect(() => {
    if (open) {
      menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    }
  }, [open]);

  function closeToTrigger() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeToTrigger();
    }
  }

  function pick(mode: InterruptionsMode) {
    closeToTrigger();
    if (mode !== view?.mode) {
      void actions.setInterruptions(mode);
    }
  }

  function sendTest() {
    closeToTrigger();
    void actions.sendTestNotification();
  }

  const canTest = Boolean(window.postpile?.sendTestNotification);
  const title = view ? 'When PostPile may show a Mac notification' : interruptions.isError ? 'Could not load the interruptions setting' : 'Loading…';
  return (
    <div ref={root} className="relative">
      {open && view && (
        <div
          ref={menu}
          role="menu"
          aria-label="Interruptions"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 bottom-full left-0 z-30 mb-1 flex flex-col gap-0.5 rounded-row bg-surface p-1.5 shadow-menu"
        >
          {INTERRUPTIONS_ORDER.map((mode) => (
            <ModeItem key={mode} mode={mode} checked={mode === view.mode} roundupTimes={view.roundupTimes} onPick={() => pick(mode)} />
          ))}
          <div aria-hidden="true" className="mx-0.5 my-1 h-px bg-hairline-soft" />
          <button
            type="button"
            role="menuitem"
            disabled={!canTest}
            title={canTest ? 'Send a test Mac notification' : 'Only in the desktop app'}
            onClick={sendTest}
            className="rounded-md px-2 py-1.5 text-left text-[11.5px] text-hint hover:bg-subtle hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-hint"
          >
            Send a test notification
          </button>
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!view}
        title={title}
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-control px-2 py-[7px] text-left text-[12.5px] disabled:opacity-50 ${
          open ? 'bg-surface font-semibold text-ink shadow-active-row' : 'text-ink-2 hover:bg-surface/60'
        }`}
      >
        <span className="text-muted">{view?.mode === 'never' || !view ? <BellOffIcon /> : <BellIcon />}</span>
        Interruptions
        {view && <span className="ml-auto text-[11px] font-normal text-hint">{interruptionsRowValue(view.mode)}</span>}
        <span className={`text-faint ${view ? '' : 'ml-auto'} ${open ? 'rotate-180' : ''}`}>
          <ChevronIcon />
        </span>
      </button>
    </div>
  );
}
