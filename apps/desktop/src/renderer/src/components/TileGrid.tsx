import { useState } from 'react';
import type { TileView, TopicDetail, TopicListItem } from '@code-manager/core';
import { tileMatchesFilter, tilesInTierOrder, type QueueFilter } from '../lib/queues.ts';
import { ChevronIcon } from './icons.tsx';
import { Tile } from './Tile.tsx';

type TileFilter = 'all' | 'unread';

interface TileGridProps {
  detail: TopicDetail;
  topics: TopicListItem[];
  selectedTileId: string | null;
  selectedPrKey: string | null;
  onSelect: (tileId: string, prKey: string) => void;
  /** Tiles the search bar lets through; null shows all. */
  matchingTileIds: Set<string> | null;
  /** The sidebar's queue filter: matching tiles stand out, the others fade but stay. */
  queueFilter: QueueFilter | null;
}

function FilterButton(props: { label: string; active: boolean; onClick: () => void }) {
  const look = props.active ? 'bg-surface text-ink shadow-segment' : 'text-muted hover:text-ink';
  return (
    <button type="button" onClick={props.onClick} className={`h-[22px] rounded-[5px] px-2.5 text-[11.5px] ${look}`}>
      {props.label}
    </button>
  );
}

/**
 * Tiles in one column, never side by side: the selected tile's notch then
 * always points straight at the detail pane.
 */
function Grid(props: TileGridProps & { views: TileView[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      {props.views.map((view) => (
        <Tile
          key={view.tile.id}
          view={view}
          sets={props.detail.sets}
          topics={props.topics}
          selected={view.tile.id === props.selectedTileId}
          selectedPrKey={props.selectedPrKey}
          onSelect={(prKey) => props.onSelect(view.tile.id, prKey)}
          filterMatch={props.queueFilter === null ? null : tileMatchesFilter(view, props.queueFilter)}
        />
      ))}
    </div>
  );
}

/** "Done (4)" or "Snoozed (2)": folded tiles, expanded on click or while one of them is selected. */
function FoldedTiles(props: TileGridProps & { label: string; views: TileView[] }) {
  const [open, setOpen] = useState(false);
  if (props.views.length === 0) {
    return null;
  }
  // Open while filtering too: a match should not hide behind a fold.
  const expanded = open || props.matchingTileIds !== null || props.views.some((view) => view.tile.id === props.selectedTileId);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex items-center gap-1.5 rounded-row border border-hairline bg-done px-3 py-2 text-left text-xs text-muted hover:text-ink"
      >
        <span className={expanded ? '' : '-rotate-90'}>
          <ChevronIcon />
        </span>
        {props.label} <span className="font-mono text-[10.5px] text-faint">({props.views.length})</span>
      </button>
      {expanded && <Grid {...props} />}
    </div>
  );
}

function emptyText(filter: TileFilter, total: number, searching: boolean): string {
  if (total === 0) {
    return searching ? 'No tile here matches the filter.' : 'Nothing in this topic pinged you.';
  }
  return filter === 'unread' ? 'No unread tiles here.' : 'Nothing open here.';
}

/**
 * The whole topic, tiles in queue order (needs reply first, rest last; unread
 * before open inside a tier). Snoozed and done ones fold into a row each.
 */
export function TileGrid(props: TileGridProps) {
  const [filter, setFilter] = useState<TileFilter>('all');
  const matching = props.matchingTileIds;
  const ordered = tilesInTierOrder(props.detail.tiles);
  const tiles = matching ? ordered.filter((view) => matching.has(view.tile.id)) : ordered;
  const unread = tiles.filter((view) => view.state.kind === 'unread');
  const live = tiles.filter((view) => view.state.kind === 'unread' || view.state.kind === 'open');
  const shown = filter === 'unread' ? unread : live;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5 border-t border-hairline pt-3">
        <span className="text-xs font-semibold text-ink-2">Tiles</span>
        <span className="font-mono text-[10.5px] text-faint">
          {tiles.length} · {unread.length} unread
          {tiles.length < props.detail.tiles.length && ` · ${props.detail.tiles.length - tiles.length} filtered out`}
        </span>
        <div className="ml-auto flex rounded-control bg-segment p-0.5">
          <FilterButton label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterButton label="Unread" active={filter === 'unread'} onClick={() => setFilter('unread')} />
        </div>
      </div>
      {shown.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">
          {emptyText(filter, tiles.length, matching !== null)}
        </p>
      )}
      <Grid {...props} views={shown} />
      {filter === 'all' && <FoldedTiles {...props} label="Snoozed" views={tiles.filter((view) => view.state.kind === 'snoozed')} />}
      {filter === 'all' && <FoldedTiles {...props} label="Done" views={tiles.filter((view) => view.state.kind === 'done')} />}
    </div>
  );
}
