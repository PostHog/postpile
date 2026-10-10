// How many popover menus are open right now. The open-read dwell waits while
// one is: a mark landing under an open Snooze or "…" menu swaps the tile's
// footer and closes the menu under the cursor (BOARD-A-06).

let openCount = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Whether any menu is open. */
export function anyMenuOpen(): boolean {
  return openCount > 0;
}

/** Calls `listener` whenever a menu opens or closes; returns the unsubscribe. */
export function onMenusChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A menu opened: counts it until the returned release is called (once). */
export function holdMenuOpen(): () => void {
  openCount += 1;
  notify();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    openCount -= 1;
    notify();
  };
}
