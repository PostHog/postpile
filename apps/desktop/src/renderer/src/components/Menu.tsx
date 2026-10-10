import { type ReactNode, useEffect, useRef, useState } from 'react';
import { holdMenuOpen } from '../lib/open-menus.ts';
import { Button, type ButtonSize, type ButtonVariant } from './Button.tsx';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /**
   * Instead of closing, the popover swaps its list for this panel (a picker).
   * Escape steps back to the list. `close` closes the whole menu, after a pick.
   */
  panel?: (close: () => void) => ReactNode;
  /** Shown on hover, e.g. why an item writes to GitHub. */
  title?: string;
}

interface MenuProps {
  label: ReactNode;
  items: MenuItem[];
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** Open upwards, for menus at the bottom of a pane. */
  up?: boolean;
  align?: 'left' | 'right';
  disabled?: boolean;
  /** Hover text for the button, e.g. when the label is a glyph. */
  title?: string;
  /** Extra classes for the button, e.g. the joined edge of a split button. */
  buttonClassName?: string;
}

/** A button with a small popover list. Closes on pick, outside click or Escape. */
export function Menu(props: MenuProps) {
  const [open, setOpen] = useState(false);
  // The label of the item whose panel is showing, null for the list.
  const [panelOf, setPanelOf] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // The open-read dwell waits while a menu is open, so a mark cannot close this one under the cursor.
  useEffect(() => (open ? holdMenuOpen() : undefined), [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (panelOf === null) {
          setOpen(false);
        } else {
          setPanelOf(null);
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelOf]);

  function close() {
    setOpen(false);
    setPanelOf(null);
  }

  const panel = props.items.find((item) => item.label === panelOf)?.panel;
  const position = `${props.up ? 'bottom-full mb-1' : 'top-full mt-1'} ${props.align === 'right' ? 'right-0' : 'left-0'}`;
  return (
    <div ref={root} className="relative">
      <Button variant={props.variant} size={props.size} className={props.buttonClassName} disabled={props.disabled} title={props.title} aria-label={props.title} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        {props.label}
      </Button>
      {open && (
        <div role="menu" className={`absolute z-20 flex min-w-44 flex-col rounded-row bg-surface p-1 shadow-menu ${position}`}>
          {panel ? panel(close) : props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.title}
              className="rounded-md px-2.5 py-1.5 text-left text-xs whitespace-nowrap text-ink-2 hover:bg-accent-soft hover:text-ink"
              onClick={() => {
                if (item.panel) {
                  setPanelOf(item.label);
                  return;
                }
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
