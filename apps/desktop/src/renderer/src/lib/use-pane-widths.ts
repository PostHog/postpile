import { useEffect, useState } from 'react';
import { DEFAULT_PANE_WIDTHS, paneWidthsKey, parsePaneWidths, type PaneWidths, type ResizablePane } from './pane-widths.ts';

function loadWidths(key: string): PaneWidths {
  try {
    return parsePaneWidths(window.localStorage.getItem(key));
  } catch {
    return DEFAULT_PANE_WIDTHS;
  }
}

function saveWidths(key: string, widths: PaneWidths): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Storage can be blocked; the widths then last until the window closes.
  }
}

/**
 * The dragged pane widths, kept per viewer in localStorage. `setWidth` changes
 * a width live during a drag; `commit` stores the current widths (drag end,
 * double-click reset). A per-viewer convenience, so a failing storage is fine.
 */
export function usePaneWidths(login: string | null) {
  const key = paneWidthsKey(login);
  const [widths, setWidths] = useState<PaneWidths>(() => loadWidths(key));
  // The viewer arrives after the first render; load their widths then.
  useEffect(() => {
    setWidths(loadWidths(key));
  }, [key]);

  const setWidth = (pane: ResizablePane, width: number | null) => {
    setWidths((current) => ({ ...current, [pane]: width }));
  };
  const commit = (next: PaneWidths) => saveWidths(key, next);
  const reset = (pane: ResizablePane) => {
    const next = { ...widths, [pane]: null };
    setWidths(next);
    saveWidths(key, next);
  };
  return { widths, setWidth, commit, reset };
}
