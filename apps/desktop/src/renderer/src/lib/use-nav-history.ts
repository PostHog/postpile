import { useEffect, useRef, useState } from 'react';
import {
  canGoBack,
  canGoForward,
  currentEntry,
  entryUsable,
  goBack,
  goForward,
  navigate,
  replaceCurrent,
  startHistory,
  type NavEntry,
} from './history.ts';

export interface NavHistoryControls {
  current: NavEntry;
  navigate: (entry: NavEntry) => void;
  /** Rewrites the current entry in place (pinning fallbacks), no new entry. */
  replace: (entry: NavEntry) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

/** Back / forward over the user's navigations. Entries whose topic is not in `topicIds` are skipped. */
export function useNavHistory(topicIds: ReadonlySet<string>): NavHistoryControls {
  const [history, setHistory] = useState(startHistory);
  const usable = (entry: NavEntry) => entryUsable(entry, topicIds);
  return {
    current: currentEntry(history),
    navigate: (entry) => setHistory((previous) => navigate(previous, entry)),
    replace: (entry) => setHistory((previous) => replaceCurrent(previous, entry)),
    back: () => setHistory((previous) => goBack(previous, usable)),
    forward: () => setHistory((previous) => goForward(previous, usable)),
    canBack: canGoBack(history, usable),
    canForward: canGoForward(history, usable),
  };
}

/** Typing in a field keeps its own shortcuts. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Mouse buttons 3 and 4 are the side "back" and "forward" buttons. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/**
 * Wires Cmd+[ / Cmd+], the mouse side buttons and (in the desktop app) the
 * trackpad swipe to back / forward. Cmd+Left/Right is left alone on purpose:
 * text fields use it to jump to line start and end.
 */
export function useNavShortcuts(back: () => void, forward: () => void): void {
  // The listeners are added once and call the latest callbacks through this ref.
  const latest = useRef({ back, forward });
  useEffect(() => {
    latest.current = { back, forward };
  });
  useEffect(() => {
    const goBack = () => latest.current.back();
    const goForward = () => latest.current.forward();
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || isTextField(event.target)) {
        return;
      }
      if (event.key === '[') {
        event.preventDefault();
        goBack();
      } else if (event.key === ']') {
        event.preventDefault();
        goForward();
      }
    };
    // preventDefault also stops a browser (web mode) from leaving the page.
    const onMouse = (event: MouseEvent) => {
      if (event.button === MOUSE_BACK) {
        event.preventDefault();
        goBack();
      } else if (event.button === MOUSE_FORWARD) {
        event.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    const stopSwipe = window.postpile?.onSwipe?.((direction) => (direction === 'back' ? goBack() : goForward()));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
      stopSwipe?.();
    };
  }, []);
}
