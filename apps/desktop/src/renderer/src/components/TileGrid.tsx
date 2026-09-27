import { useState } from 'react';
import type { TopicDetail, TopicListItem } from '@code-manager/core';
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

/** The topic's tiles, two per row when there is room. */
export function TileGrid(props: TileGridProps) {
  const [filter, setFilter] = useState<TileFilter>('all');
  const tiles = props.detail.tiles;
  const unread = tiles.filter((view) => view.state.kind === 'unread');
  const shown = filter === 'unread' ? unread : tiles;
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
          {tiles.length === 0 ? 'Nothing in this topic pinged you.' : 'No unread tiles here.'}
        </p>
      )}
      <div className="@container">
        <div className="grid auto-rows-[minmax(282px,auto)] grid-cols-1 gap-3.5 @2xl:grid-cols-2">
          {shown.map((view) => (
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
    </div>
  );
}
