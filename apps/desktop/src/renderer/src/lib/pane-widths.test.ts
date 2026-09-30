import { describe, expect, it } from 'vitest';
import { clampPaneWidth, paneColumns, paneWidthsKey, parsePaneWidths, resolvedColumnWidths } from './pane-widths.ts';

describe('pane widths', () => {
  it('splits what the sidebar leaves evenly between tiles and detail until a pane is dragged', () => {
    expect(paneColumns({ sidebar: null, tiles: null })).toEqual({
      sidebar: 'clamp(248px,22vw,330px)',
      tiles: 'calc((100% - clamp(248px,22vw,330px)) / 2)',
      template: 'clamp(248px,22vw,330px) calc((100% - clamp(248px,22vw,330px)) / 2) minmax(0,1fr)',
    });
    expect(paneColumns({ sidebar: 300, tiles: null }).template).toBe('300px calc((100% - 300px) / 2) minmax(0,1fr)');
  });

  it('keeps a dragged tile width', () => {
    expect(paneColumns({ sidebar: null, tiles: 520 }).template).toBe('clamp(248px,22vw,330px) 520px minmax(0,1fr)');
  });

  it('clamps a drag to the pane limits and the room left', () => {
    expect(clampPaneWidth('sidebar', 120, 1000)).toBe(200);
    expect(clampPaneWidth('sidebar', 900, 1000)).toBe(440);
    expect(clampPaneWidth('tiles', 600.4, 1000)).toBe(600);
    expect(clampPaneWidth('tiles', 700, 500)).toBe(500);
    // No room at all still keeps the minimum.
    expect(clampPaneWidth('tiles', 700, 100)).toBe(340);
    // The tile column is no longer capped at 720; the room decides.
    expect(clampPaneWidth('tiles', 900, 1000)).toBe(900);
  });

  it('reads stored widths defensively', () => {
    expect(parsePaneWidths(null)).toEqual({ sidebar: null, tiles: null });
    expect(parsePaneWidths('not json')).toEqual({ sidebar: null, tiles: null });
    expect(parsePaneWidths('{"sidebar":280,"tiles":"wide"}')).toEqual({ sidebar: 280, tiles: null });
    expect(parsePaneWidths('{"sidebar":5000,"tiles":10}')).toEqual({ sidebar: 440, tiles: 340 });
    expect(parsePaneWidths('{"sidebar":null,"tiles":800}')).toEqual({ sidebar: null, tiles: 800 });
  });

  it('keys the widths per viewer', () => {
    expect(paneWidthsKey('viewer')).toBe('postpile.paneWidths.viewer');
    expect(paneWidthsKey(null)).toBe('postpile.paneWidths.anonymous');
  });

  it('parses a computed grid template', () => {
    expect(resolvedColumnWidths('316.8px 475.2px 648px')).toEqual([316.8, 475.2, 648]);
  });
});
