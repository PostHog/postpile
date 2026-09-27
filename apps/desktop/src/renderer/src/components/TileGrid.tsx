import { useState } from 'react';
import type { TileView, TopicDetail, TopicListItem } from '@code-manager/core';
import { ChevronIcon } from './icons.tsx';
import { Tile } from './Tile.tsx';

type TileFilter = 'all' | 'unread';

interface TileGridProps {
  detail: TopicDetail;
  topics: TopicListItem[];
  selectedTileId: string | null;
  selectedPrKey: string | null;
  onSelect: (tileId: string, prKey: string) => void;
}

function FilterButton(props: { label: string; active: boolean; onClick: () => void }) {
  const look = props.active ? 'bg-surface text-ink shadow-segment' : 'text-muted hover:text-ink';
  return (
    <button type="button" onClick={props.onClick} className={`h-[22px] rounded-[5px] px-2.5 text-[11.5px] ${look}`}>
      {props.label}
    </button>
  );
}

/** Tiles two per row when there is room. */
function Grid(props: TileGridProps & { views: TileView[] }) {
  return (
    <div className="@container">
      <div className="grid auto-rows-[minmax(282px,auto)] grid-cols-1 gap-3.5 @2xl:grid-cols-2">
        {props.views.map((view) => (
          <Tile
            key={view.tile.id}
            view={view}
            sets={props.detail.sets}
            topics={props.topics}
            selected={view.tile.id === props.selectedTileId}
            selectedPrKey={props.selectedPrKey}
            onSelect={(prKey) => props.onSelect(view.tile.id, prKey)}
          />
        ))}
      </div>
    </div>
  );
}

/** "Done (4)" or "Snoozed (2)": folded tiles, expanded on click or while one of them is selected. */
function FoldedTiles(props: TileGridProps & { label: string; views: TileView[] }) {
  const [open, setOpen] = useState(false);
  if (props.views.length === 0) {
    return null;
  }
  const expanded = open || props.views.some((view) => view.tile.id === props.selectedTileId);
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

/** The topic's live tiles (unread first, then open); snoozed and done ones fold into a row each. */
export function TileGrid(props: TileGridProps) {
  const [filter, setFilter] = useState<TileFilter>('all');
  const tiles = props.detail.tiles;
  const unread = tiles.filter((view) => view.state.kind === 'unread');
  const live = tiles.filter((view) => view.state.kind === 'unread' || view.state.kind === 'open');
  const shown = filter === 'unread' ? unread : live;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5 border-t border-hairline pt-3">
        <span className="text-xs font-semibold text-ink-2">Tiles</span>
        <span className="font-mono text-[10.5px] text-faint">
          {tiles.length} · {unread.length} unread
        </span>
        <div className="ml-auto flex rounded-control bg-segment p-0.5">
          <FilterButton label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterButton label="Unread" active={filter === 'unread'} onClick={() => setFilter('unread')} />
        </div>
      </div>
      {shown.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">
          {tiles.length === 0 ? 'Nothing in this topic pinged you.' : filter === 'unread' ? 'No unread tiles here.' : 'Nothing open here.'}
        </p>
      )}
      <Grid {...props} views={shown} />
      {filter === 'all' && <FoldedTiles {...props} label="Snoozed" views={tiles.filter((view) => view.state.kind === 'snoozed')} />}
      {filter === 'all' && <FoldedTiles {...props} label="Done" views={tiles.filter((view) => view.state.kind === 'done')} />}
    </div>
  );
}
