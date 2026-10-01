import { useEffect, useState } from 'react';
import type { MarkLabel, PrKey } from '@postpile/core';
import { useOpenedReadState, type OpenedMark } from '../lib/use-opened-read.ts';
import { OPENED_READ_DELAY_MS } from '../lib/opened-read.ts';
import { Button, buttonClasses, type ButtonVariant } from './Button.tsx';
import { CheckIcon } from './icons.tsx';

interface MarkButtonProps {
  prKey: PrKey;
  variant: ButtonVariant;
  label: MarkLabel;
  title: string;
  disabled: boolean;
  onClick: () => void;
}

/** The fill is a lighter wash on ink, a darker one on the outlined look. */
const FILLS: Record<ButtonVariant, string> = {
  primary: 'bg-on-ink/20',
  safe: 'bg-on-ink/20',
  secondary: 'bg-ink/10',
  move: 'bg-ink/10',
  'safe-soft': 'bg-safe/10',
  joined: 'bg-ink/10',
};

/** What the button said, in the past tense. */
const MARKED_WORDS: Record<MarkLabel, string> = { 'Mark read': 'Marked read', 'Done for now': 'Done for now' };

/**
 * "✓ Marked read" (or "✓ Done for now") after the open marked the PR when the
 * dwell ended, with Undo next to it while the undo window is open. Shown in
 * the mark button's place, also after core stopped offering the button (the
 * PR is done now).
 */
export function OpenedMarkNote(props: { mark: OpenedMark; onUndo: () => void }) {
  return (
    <span className="flex items-center gap-2">
      <span role="status" className={buttonClasses('safe-soft', 'md')}>
        <CheckIcon />
        {MARKED_WORDS[props.mark.label]}
      </span>
      {props.mark.canUndo && (
        <button
          type="button"
          title="Takes the mark back: the PR is unread again and GitHub is not told"
          onClick={props.onUndo}
          className="text-[12.5px] font-medium text-accent hover:underline"
        >
          Undo
        </button>
      )}
    </span>
  );
}

/**
 * The detail pane's mark button. While the PR in the pane waits out the dwell
 * (`useOpenedRead`: 1.5s visible), it fills left to right; when the fill
 * completes the open marks the PR and the pane shows `OpenedMarkNote`
 * instead. Clicking the button itself marks right away, as always.
 */
export function MarkButton(props: MarkButtonProps) {
  const opened = useOpenedReadState();
  const filling = opened.prKey === props.prKey && opened.filling;
  // The fill mounts empty and grows a frame later, so the width change animates.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!filling) {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [filling]);

  return (
    <Button variant={props.variant} size="md" title={props.title} disabled={props.disabled} onClick={props.onClick} className="relative overflow-hidden">
      {filling && (
        <span
          aria-hidden="true"
          data-testid="mark-fill"
          className={`absolute inset-y-0 left-0 ease-linear ${FILLS[props.variant]}`}
          style={{ width: grown ? '100%' : '0%', transitionProperty: 'width', transitionDuration: `${OPENED_READ_DELAY_MS}ms` }}
        />
      )}
      <span className="relative flex items-center gap-1.5">{props.label}</span>
    </Button>
  );
}
