import type { ChipTone } from '../lib/setup.ts';

const TONES: Record<ChipTone, string> = {
  good: 'bg-status-good-soft text-status-good',
  bad: 'bg-status-bad-soft text-status-bad',
  warn: 'bg-status-queued-soft text-status-queued',
  quiet: 'bg-quiet-soft text-muted',
  busy: 'bg-accent-soft text-accent',
};

/** A worded state chip for the setup screens ("OK", "Fix this", "Working"). Words, never a symbol alone. */
export function SetupChip(props: { tone: ChipTone; word: string; title?: string }) {
  return (
    <span
      title={props.title}
      className={`inline-flex h-[19px] shrink-0 justify-self-start items-center rounded-full px-2 text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap ${TONES[props.tone]}`}
    >
      {props.word}
    </span>
  );
}
