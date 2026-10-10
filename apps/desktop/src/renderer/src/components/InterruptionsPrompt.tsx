import { useEffect, useState } from 'react';
import type { InterruptionsMode } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useInboxCleanup } from '../api/cleanup.ts';
import { useInterruptions } from '../api/interruptions.ts';
import { useSetupStatus } from '../api/setup.ts';
import { useTools } from '../api/tools.ts';
import { interruptionsLead, interruptionsLeadText, interruptionsPromptHint, interruptionsPromptWaits, showsInterruptionsPrompt, type InterruptionsLead } from '../lib/interruptions.ts';
import { Button } from './Button.tsx';
import { InterruptionsChoice } from './InterruptionsChoice.tsx';

/**
 * The dialog: the three cards with the stored mode preselected, the pick
 * held here. Save stores the pick; Esc and a click outside store the stored
 * mode (Never), so closing counts as a choice too and it never asks again.
 * It closes only once the save landed: on a failure (the action shows the
 * error toast) it stays open, so the user can try again.
 */
function InterruptionsPromptDialog(props: { mode: InterruptionsMode; roundupTimes: string[]; lead: InterruptionsLead; onClose: () => void }) {
  const actions = useActions();
  const { roundupTimes, onClose } = props;
  // The mode when the dialog opened: the setInterruptions early cache update changes the prop while a save runs.
  const [stored] = useState<InterruptionsMode>(props.mode);
  const [pick, setPick] = useState<InterruptionsMode>(props.mode);
  const [saving, setSaving] = useState(false);

  async function save(chosen: InterruptionsMode) {
    if (saving) {
      return;
    }
    setSaving(true);
    const saved = await actions.setInterruptions(chosen, 'prompt');
    setSaving(false);
    if (saved) {
      onClose();
    }
  }

  const dismiss = () => void save(stored);

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
            {interruptionsLeadText(props.lead)}
          </p>
        </div>
        <InterruptionsChoice mode={pick} roundupTimes={roundupTimes} onPick={setPick} />
        <div className="flex items-center gap-2.5 pt-0.5">
          <Button variant="primary" disabled={saving} onClick={() => void save(pick)}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <span className="flex flex-col text-[11.5px] leading-snug text-hint">
            {interruptionsPromptHint(stored, pick).map((line) => (
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
 * cleanup start dialog, which goes first, nor while a cleanup runs or gh is
 * unusable. Once a save landed it hides for
 * good: the view says `chosen` from then on, and `closed` keeps it hidden
 * for the session anyway.
 */
export function InterruptionsPrompt(props: { blocked: boolean }) {
  const view = useInterruptions().data;
  const cleanup = useInboxCleanup().data;
  const tools = useTools().data;
  const setup = useSetupStatus().data;
  const [closed, setClosed] = useState(false);
  const waits = props.blocked || setup === undefined || interruptionsPromptWaits(cleanup, tools);
  if (view === undefined || closed || !showsInterruptionsPrompt(view, waits)) {
    return null;
  }
  return <InterruptionsPromptDialog mode={view.mode} roundupTimes={view.roundupTimes} lead={interruptionsLead(setup)} onClose={() => setClosed(true)} />;
}
