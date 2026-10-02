import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { DriverChoice, TopicDriverView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { choiceHelper, choiceLabel, driverLabel } from '../lib/driver.ts';
import { sectionLook } from '../lib/sections.ts';
import { Avatar } from './Avatar.tsx';
import { CheckIcon, ChevronIcon } from './icons.tsx';

/** The menu's width in px; it opens under the button, pulled left when it would leave the window. */
const MENU_WIDTH = 340;

const itemClass = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink outline-none hover:bg-accent-soft focus-visible:bg-accent-soft';

function ChoiceItem(props: { choice: DriverChoice; onPick: (value: string) => void }) {
  const { choice } = props;
  const helper = choiceHelper(choice);
  return (
    <button type="button" role="menuitemradio" aria-checked={choice.current} className={itemClass} onClick={() => props.onPick(choice.value)}>
      <span className="flex w-3 shrink-0 text-accent">{choice.current && <CheckIcon />}</span>
      {choice.login && <Avatar login={choice.login} size="xs" />}
      <span className="min-w-0">
        {choiceLabel(choice)}
        {helper && <span className="block text-[11px] text-hint">{helper}</span>}
      </span>
      <span className="ml-auto pl-3 text-[11px] whitespace-nowrap text-hint">{sectionLook(choice.section).label}</span>
    </button>
  );
}

/**
 * "<login> drives" on the topic header as a button. Its menu picks who
 * drives: You, each teammate, Your team, Someone outside your team, each
 * with the section the topic moves to, and Reset to automatic once a pick
 * is set. A pick moves the topic at once and stands until changed (local
 * only). Escape closes, arrow keys, Home and End move between items.
 */
export function DriverMenu(props: { topicId: string; driver: TopicDriverView }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  // Fixed to the window, so the tile pane's overflow never clips it.
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { driver } = props;
  const people = driver.choices.filter((choice) => choice.kind === 'you' || choice.kind === 'person');
  const others = driver.choices.filter((choice) => choice.kind === 'team' || choice.kind === 'outside');

  function menuItems(): HTMLButtonElement[] {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const items = menuItems();
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    // The header scrolls with the pane; a fixed menu would float away, so it closes.
    function onScroll(event: Event) {
      if (!menu.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function openMenu() {
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      setPlace({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)) });
    }
    setOpen(true);
  }

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const targets: Record<string, number> = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 };
    if (event.key in targets) {
      event.preventDefault();
      items[targets[event.key]!]?.focus();
    }
  }

  function onButtonKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      openMenu();
    }
  }

  async function pick(value: string | null) {
    close();
    await actions.setTopicDriver(props.topicId, value);
  }

  return (
    <div ref={root} className="flex items-center gap-1.5">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={actions.isBusy(`topicDriver:${props.topicId}`)}
        title="Who drives this topic. Change it to move the topic."
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
        className={`flex h-5 items-center gap-[5px] rounded-full pr-1.5 text-[11px] whitespace-nowrap hover:bg-accent-soft hover:text-accent ${driver.login ? 'pl-[3px]' : 'pl-2'} ${open ? 'bg-accent-soft text-accent' : 'bg-pill-quiet text-ink-2'}`}
      >
        {driver.login && <Avatar login={driver.login} size="xxs" />}
        {driver.kind === 'person' ? (
          <span>
            <span className={`font-[550] ${open ? '' : 'text-ink'}`}>{driver.login}</span> drives
          </span>
        ) : (
          <span>{driverLabel(driver)}</span>
        )}
        <span className="text-faint">
          <ChevronIcon size={8} />
        </span>
      </button>
      {driver.picked && <span className="text-[10.5px] whitespace-nowrap text-hint">set by you</span>}
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Who drives this topic?"
          onKeyDown={onMenuKeyDown}
          style={{ top: place.top, left: place.left, width: MENU_WIDTH }}
          className="fixed z-30 flex flex-col rounded-row bg-surface p-1 shadow-menu"
        >
          <div className="px-2 pt-[5px] pb-[3px] text-[10.5px] text-hint">Who drives this topic?</div>
          {people.map((choice) => (
            <ChoiceItem key={choice.value} choice={choice} onPick={(value) => void pick(value)} />
          ))}
          {people.length > 0 && <hr className="mx-1.5 my-1 border-hairline" />}
          {others.map((choice) => (
            <ChoiceItem key={choice.value} choice={choice} onPick={(value) => void pick(value)} />
          ))}
          {driver.picked && (
            <>
              <hr className="mx-1.5 my-1 border-hairline" />
              <button type="button" role="menuitem" className={itemClass} onClick={() => void pick(null)}>
                <span className="w-3 shrink-0" />
                Reset to automatic
              </button>
            </>
          )}
          {driver.heldByAsk && (
            <div className="mt-1 border-t border-hairline px-2 pt-1.5 pb-1 text-[11px] leading-[1.45] text-hint">
              Stays in {sectionLook(driver.heldByAsk).label} while that ask is open.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
