import type { InterruptionsMode } from '@postpile/core';
import { interruptionsCard, INTERRUPTIONS_ORDER } from '../lib/interruptions.ts';
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

/** The three modes as cards side by side: setup's "Your day" and the one-time prompt for installs that never chose. */
export function InterruptionsChoice(props: { mode: InterruptionsMode; roundupTimes: string[]; onPick: (mode: InterruptionsMode) => void }) {
  return (
    <div role="group" aria-label="When PostPile may notify you" className="grid grid-cols-3 gap-2.5">
      {INTERRUPTIONS_ORDER.map((mode) => (
        <ModeCard key={mode} mode={mode} picked={mode === props.mode} roundupTimes={props.roundupTimes} onPick={() => props.onPick(mode)} />
      ))}
    </div>
  );
}
