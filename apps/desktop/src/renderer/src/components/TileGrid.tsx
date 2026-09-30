import type { TileGroup, TileView, TopicDetail, TopicListItem } from '@postpile/core';
import { gridGroups } from '../lib/queues.ts';
import { useHeldPlace } from '../lib/use-held-place.ts';
import { ChevronIcon } from './icons.tsx';
import { Tile } from './Tile.tsx';

interface TileGridProps {
  detail: TopicDetail;
  topics: TopicListItem[];
  selectedTileId: string | null;
  selectedPrKey: string | null;
  onSelect: (tileId: string, prKey: string) => void;
  /** Tiles the search bar lets through; null shows all. */
  matchingTileIds: Set<string> | null;
  /** The Dealt with group is open: folded by default, kept for the session. */
  dealtWithOpen: boolean;
  onDealtWithOpen: (open: boolean) => void;
}

/** Group names on screen. "Dealt with" is the tile state `done`; a finished topic stays "Finished". */
const GROUP_LABELS: Record<TileGroup, string> = { unread: 'Unread', open: 'Open', dealt_with: 'Dealt with' };

function TileCount(props: { count: number }) {
  return <span className="font-mono text-[10.5px] font-semibold text-hint tabular-nums">{props.count}</span>;
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
        />
      ))}
    </div>
  );
}

/** Unread or Open: the name and count sit right on top of the group's first tile. */
function GroupSection(props: TileGridProps & { group: TileGroup; views: TileView[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-1.5 pl-1 text-[11.5px] leading-[normal] font-semibold text-ink-2">
        {GROUP_LABELS[props.group]}
        <TileCount count={props.views.length} />
      </h3>
      <Grid {...props} />
    </section>
  );
}

/** "Dealt with (4)": folded by default, open on click (for the session), while filtering or while one of its tiles is selected. */
function DealtWithGroup(props: TileGridProps & { views: TileView[] }) {
  // Open while filtering too: a match should not hide behind a fold.
  const expanded = props.dealtWithOpen || props.matchingTileIds !== null || props.views.some((view) => view.tile.id === props.selectedTileId);
  return (
    <section className="flex flex-col gap-2">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => props.onDealtWithOpen(!expanded)}
          className="flex items-center gap-1 rounded-[3px] pl-0.5 text-[11.5px] leading-[normal] font-semibold text-muted hover:text-ink"
        >
          <span className={expanded ? '' : '-rotate-90'}>
            <ChevronIcon />
          </span>
          {GROUP_LABELS.dealt_with} <span className="font-mono text-[10.5px] font-normal text-hint">({props.views.length})</span>
        </button>
      </h3>
      {expanded && <Grid {...props} />}
    </section>
  );
}

function tileId(view: TileView): string {
  return view.tile.id;
}

/**
 * The whole topic in three groups (DESIGN.md "Groups inside a topic"):
 * Unread, Open, Dealt with, always in this order, by core's
 * `TileView.group`; empty groups don't show. Inside a group tiles go in
 * queue order (needs reply first, rest last). The selected tile keeps the
 * place it had when it was selected, even when its group changed (a mark,
 * the opened mark, a sync), until the selection moves ("Marked when you move
 * on", `useHeldPlace`); its look changes right away.
 */
export function TileGrid(props: TileGridProps) {
  const matching = props.matchingTileIds;
  const tiles = matching ? props.detail.tiles.filter((view) => matching.has(view.tile.id)) : props.detail.tiles;
  const unreadCount = tiles.filter((view) => view.group === 'unread').length;
  const groups = useHeldPlace(props.selectedTileId, props.selectedTileId, gridGroups(tiles), tileId).filter((bucket) => bucket.items.length > 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 pt-[13px] shadow-[inset_0_1px_0_var(--hairline)]">
        <span className="text-xs font-semibold text-ink-2">Tiles</span>
        <span className="flex items-baseline gap-[5px] text-[11px] text-faint">
          <TileCount count={tiles.length} />
          <span className="text-ghost">·</span>
          <span>
            <TileCount count={unreadCount} /> unread
          </span>
          {tiles.length < props.detail.tiles.length && (
            <>
              <span className="text-ghost">·</span>
              <span>
                <TileCount count={props.detail.tiles.length - tiles.length} /> filtered out
              </span>
            </>
          )}
        </span>
      </div>
      {tiles.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">
          {matching !== null ? 'No tile here matches the filter.' : 'Nothing in this topic pinged you.'}
        </p>
      )}
      {groups.map((bucket) =>
        bucket.key === 'dealt_with' ? (
          <DealtWithGroup key={bucket.key} {...props} views={bucket.items} />
        ) : (
          <GroupSection key={bucket.key} {...props} group={bucket.key as TileGroup} views={bucket.items} />
        ),
      )}
    </div>
  );
}
