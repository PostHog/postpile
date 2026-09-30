import { useEffect, useState, type ReactNode } from 'react';
import type { PrKey } from '@postpile/core';
import { useOpenedReadState } from '../lib/use-opened-read.ts';
import { OPENED_READ_DELAY_MS } from '../lib/opened-read.ts';
import { Button, type ButtonVariant } from './Button.tsx';
import { CheckIcon, CloseIcon } from './icons.tsx';

interface MarkButtonProps {
  prKey: PrKey;
  variant: ButtonVariant;
  label: 'Mark read' | 'Done for now';
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
};

/**
 * The detail pane's mark button. While the PR in the pane waits to be marked
 * when the user leaves (`useOpenedRead`: dwell 1.5s, marked on moving on), it
 * fills left to right over the dwell and then says so; the round X next to it
 * ("Keep unread") cancels that automatic mark. Clicking the button itself
 * marks right away, as always.
 */
export function MarkButton(props: MarkButtonProps) {
  const opened = useOpenedReadState();
  const pending = opened.prKey === props.prKey ? opened.pending : null;
  // The fill mounts empty and grows a frame later, so the width change animates.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (pending === null) {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [pending]);

  const action = props.label === 'Mark read' ? 'read' : 'done';
  let content: ReactNode = props.label;
  if (pending === 'ready') {
    content = (
      <>
        <CheckIcon />
        Marks {action} when you leave
      </>
    );
  }
  return (
    <>
      <Button variant={props.variant} size="md" title={props.title} disabled={props.disabled} onClick={props.onClick} className="relative overflow-hidden">
        {pending !== null && (
          <span
            aria-hidden="true"
            data-testid="mark-fill"
            className={`absolute inset-y-0 left-0 ease-linear ${FILLS[props.variant]}`}
            style={{ width: grown ? '100%' : '0%', transitionProperty: 'width', transitionDuration: `${OPENED_READ_DELAY_MS}ms` }}
          />
        )}
        <span className="relative flex items-center gap-1.5">{content}</span>
      </Button>
      {pending !== null && (
        <Button size="icon-md" className="rounded-full" title="Keep unread" aria-label="Keep unread" onClick={opened.cancel}>
          <CloseIcon />
        </Button>
      )}
    </>
  );
}
