import { useEffect, useState } from 'react';
import type { InterruptionsMode } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useInboxCleanup } from '../api/cleanup.ts';
import { useInterruptions } from '../api/interruptions.ts';
import { interruptionsPromptHint, showsInterruptionsPrompt } from '../lib/interruptions.ts';
import { Button } from './Button.tsx';
import { InterruptionsChoice } from './InterruptionsChoice.tsx';

/**
 * The dialog: the three cards with the stored mode preselected, the pick
 * held here. Save stores the pick; Esc and a click outside store the stored
 * mode (Never), so closing counts as a choice too and it never asks again.
 */
function InterruptionsPromptDialog(props: { mode: InterruptionsMode; roundupTimes: string[]; onClose: () => void }) {
  const actions = useActions();
  const { mode, roundupTimes, onClose } = props;
  const [pick, setPick] = useState<InterruptionsMode>(mode);

  function save(chosen: InterruptionsMode) {
    void actions.setInterruptions(chosen, 'prompt');
    onClose();
  }

  const dismiss = () => save(mode);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-4" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interruptions-prompt-title"
        className="flex w-[820px] max-w-full flex-col gap-4 rounded-tile bg-surface px-5 pt-[22px] pb-[18px] shadow-menu"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="interruptions-prompt-title" className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            When should PostPile tap you on the shoulder?
          </h2>
          <p className="text-[12.5px] leading-[1.55] text-ink-2">
            New in this version: PostPile stays quiet unless you pick otherwise. Until now it sent a Mac notification as soon as something
            crucial needed you; that is “As soon as it matters” below.
          </p>
        </div>
        <InterruptionsChoice mode={pick} roundupTimes={roundupTimes} onPick={setPick} />
        <div className="flex items-center gap-2.5 pt-0.5">
          <Button variant="primary" onClick={() => save(pick)}>
            Save
          </Button>
          <span className="flex flex-col text-[11.5px] leading-snug text-hint">
            {interruptionsPromptHint(mode, pick).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The one-time question for installs that never picked a mode (DESIGN.md
 * "Interruptions"): before 0.18 they got pings by default, now Never. Mounted
 * once in App. Never on top of setup (`blocked`, from App) or the inbox
 * cleanup start dialog, which goes first. Saved or closed, it hides at once;
 * the refetched view says `chosen` from then on.
 */
export function InterruptionsPrompt(props: { blocked: boolean }) {
  const view = useInterruptions().data;
  const cleanup = useInboxCleanup().data;
  const [closed, setClosed] = useState(false);
  // Wait until the cleanup view says no start dialog is due.
  const cleanupDue = cleanup === undefined || cleanup.start !== null;
  if (view === undefined || closed || !showsInterruptionsPrompt(view, props.blocked || cleanupDue)) {
    return null;
  }
  return <InterruptionsPromptDialog mode={view.mode} roundupTimes={view.roundupTimes} onClose={() => setClosed(true)} />;
}
