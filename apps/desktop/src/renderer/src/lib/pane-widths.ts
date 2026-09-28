/**
 * Widths of the two resizable panes (sidebar and tile column). The detail
 * pane always takes the rest. Null means "not dragged": the pane uses its
 * default clamp from DESIGN.md "Three-pane balance", which is also what a
 * double-click on a divider resets to.
 */
export type ResizablePane = 'sidebar' | 'tiles';

export interface PaneWidths {
  sidebar: number | null;
  tiles: number | null;
}

export const DEFAULT_PANE_WIDTHS: PaneWidths = { sidebar: null, tiles: null };

/** The default column sizes, used while a pane has no dragged width. */
const DEFAULT_COLUMNS: Record<ResizablePane, string> = {
  sidebar: 'clamp(248px,22vw,330px)',
  tiles: 'clamp(420px,33vw,480px)',
};

const PANE_LIMITS: Record<ResizablePane, { min: number; max: number }> = {
  sidebar: { min: 200, max: 440 },
  tiles: { min: 340, max: 720 },
};

/** The detail pane never gets squeezed below this by a drag. */
export const DETAIL_MIN_WIDTH = 360;

/**
 * Clamps a dragged width to the pane's limits and to the room left once the
 * other pane and the detail pane's minimum are taken from the window.
 */
export function clampPaneWidth(pane: ResizablePane, width: number, room: number): number {
  const limits = PANE_LIMITS[pane];
  const max = Math.max(limits.min, Math.min(limits.max, room));
  return Math.round(Math.min(max, Math.max(limits.min, width)));
}

function columnSize(pane: ResizablePane, widths: PaneWidths): string {
  const width = widths[pane];
  return width === null ? DEFAULT_COLUMNS[pane] : `${width}px`;
}

/** The CSS size of each column, for the grid and the divider positions. */
export function paneColumns(widths: PaneWidths): { sidebar: string; tiles: string; template: string } {
  const sidebar = columnSize('sidebar', widths);
  const tiles = columnSize('tiles', widths);
  return { sidebar, tiles, template: `${sidebar} ${tiles} minmax(0,1fr)` };
}

/** The localStorage key: widths are kept per viewer. */
export function paneWidthsKey(login: string | null): string {
  return `postpile.paneWidths.${login ?? 'anonymous'}`;
}

function storedWidth(pane: ResizablePane, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const limits = PANE_LIMITS[pane];
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/** Reads stored widths; anything missing or broken falls back to the default. */
export function parsePaneWidths(raw: string | null): PaneWidths {
  if (!raw) {
    return DEFAULT_PANE_WIDTHS;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { sidebar: storedWidth('sidebar', parsed.sidebar), tiles: storedWidth('tiles', parsed.tiles) };
  } catch {
    return DEFAULT_PANE_WIDTHS;
  }
}

/** Reads the resolved px widths out of a computed `grid-template-columns`. */
export function resolvedColumnWidths(template: string): number[] {
  return template
    .split(' ')
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
}
