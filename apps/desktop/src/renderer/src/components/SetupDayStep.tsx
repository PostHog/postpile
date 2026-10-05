import type { InterruptionsMode } from '@postpile/core';
import { asksNotificationPermission, interruptionsCard, INTERRUPTIONS_ORDER } from '../lib/interruptions.ts';
import { Button } from './Button.tsx';
import { InterruptionsArt } from './InterruptionsArt.tsx';

/** The radio mark before a card's title: accent ring with a dot when picked. */
function RadioMark(props: { checked: boolean }) {
  return (
    <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${props.checked ? 'border-accent' : 'border-dot-quiet'}`}>
      {props.checked && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}

/** One mode as a card: art, radio and title, the tagline, then three short lines. */
function ModeCard(props: { mode: InterruptionsMode; picked: boolean; roundupTimes: string[]; onPick: () => void }) {
  const card = interruptionsCard(props.mode, props.roundupTimes);
  const look = props.picked ? 'bg-detail-context inset-ring-[1.5px] inset-ring-accent' : 'bg-surface inset-ring inset-ring-edge-control hover:bg-subtle';
  return (
    <button
      type="button"
      aria-pressed={props.picked}
      onClick={props.onPick}
      className={`flex flex-col gap-[9px] rounded-[10px] px-3 pt-2.5 pb-3.5 text-left ${look}`}
    >
      <InterruptionsArt mode={props.mode} />
      <span className="flex items-center gap-2">
        <RadioMark checked={props.picked} />
        <span className="text-[13.5px] font-semibold text-ink">{card.title}</span>
      </span>
      <span className="pl-6 text-xs font-semibold text-ink-2">{card.tagline}</span>
      <span className="flex flex-col gap-[5px] pl-6 text-[11.5px] leading-[1.45] text-ink-2">
        {card.lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </button>
  );
}

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
      <div role="group" aria-label="When PostPile may notify you" className="grid grid-cols-3 gap-2.5">
        {INTERRUPTIONS_ORDER.map((mode) => (
          <ModeCard key={mode} mode={mode} picked={mode === props.mode} roundupTimes={props.roundupTimes} onPick={() => props.onPick(mode)} />
        ))}
      </div>
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
