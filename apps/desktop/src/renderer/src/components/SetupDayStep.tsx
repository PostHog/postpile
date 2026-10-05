import type { InterruptionsMode } from '@postpile/core';
import { asksNotificationPermission } from '../lib/interruptions.ts';
import { Button } from './Button.tsx';
import { InterruptionsChoice } from './InterruptionsChoice.tsx';

/**
 * Setup step 4, "Your day": when PostPile may show a Mac notification.
 * Never is the default; the pick is held in SetupFlow and sent with Accept.
 * The sidebar's Interruptions menu changes it later.
 */
export function SetupDayStep(props: {
  mode: InterruptionsMode;
  roundupTimes: string[];
  onPick: (mode: InterruptionsMode) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <section className="flex max-w-[820px] flex-col gap-4 rounded-tile bg-surface px-5 pt-[22px] pb-[18px] shadow-tile">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Last thing: when should PostPile tap you on the shoulder?</h2>
        <p className="text-[12.5px] leading-[1.55] text-ink-2">
          Either way your PRs are sorted into topics, and what needs you sits at the top. Pick what suits your day. You can switch any
          time from the sidebar.
        </p>
      </div>
      <InterruptionsChoice mode={props.mode} roundupTimes={props.roundupTimes} onPick={props.onPick} />
      <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
        <Button variant="primary" onClick={props.onContinue}>
          Continue
        </Button>
        <Button onClick={props.onBack}>Back</Button>
        {asksNotificationPermission(props.mode) && <span className="text-[11.5px] text-hint">macOS asks for permission once, right after setup.</span>}
      </div>
    </section>
  );
}
