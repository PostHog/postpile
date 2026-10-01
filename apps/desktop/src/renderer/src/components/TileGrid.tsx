import type { ReactNode } from 'react';
import { TopicActions } from './AgentActions.tsx';
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
  /** The user's last choice on the Dealt with group (open or closed), kept for the session; folded by default. */
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

/**
 * A group's marker (a coral dot for Unread, the chevron for Dealt with). It
 * hangs in the 15px left of the label, so the label lines up with the tile text.
 */
function GroupMarker(props: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="absolute inset-y-0 left-0 flex w-[15px] items-center justify-center">
      {props.children}
    </span>
  );
}

/** Unread or Open: the name and count sit right on top of the group's first tile. */
function GroupSection(props: TileGridProps & { group: TileGroup; views: TileView[] }) {
  return (
    <section className="flex flex-col gap-2">
      {/* 16px in: the tile's 15px padding plus its 1px frame. */}
      <h3 className="relative flex items-baseline gap-1.5 pl-4 text-[11.5px] leading-[normal] font-semibold text-ink-2">
        {props.group === 'unread' && (
          <GroupMarker>
            <span className="size-1.5 rounded-full bg-unread" />
          </GroupMarker>
        )}
        {GROUP_LABELS[props.group]}
        <TileCount count={props.views.length} />
      </h3>
      <Grid {...props} />
    </section>
  );
}

/**
 * "Dealt with 4": open or closed as the user last clicked it (for the
 * session), folded by default. Filtering or a selected tile in it opens it
 * for as long as that lasts, without changing the user's choice. The whole
 * row is the button: open, a 28px row with a rule and "Hide"; folded, a 32px
 * bar that previews the first tile's title and ends in "Show".
 */
function DealtWithGroup(props: TileGridProps & { views: TileView[] }) {
  // Open while filtering too: a match should not hide behind a fold.
  const expanded = props.dealtWithOpen || props.matchingTileIds !== null || props.views.some((view) => view.tile.id === props.selectedTileId);
  const firstTitle = props.views[0]?.tile.title ?? '';
  const box = expanded ? 'h-7' : 'h-8 rounded-row bg-done inset-ring inset-ring-edge-hairline pr-3';
  return (
    <section className="flex flex-col gap-2">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          // A click says what the user wants from what they see: open when folded, closed when open.
          onClick={() => props.onDealtWithOpen(!expanded)}
          className={`group relative flex w-full items-center gap-1.5 rounded-row pl-4 text-left text-[11.5px] leading-[normal] font-semibold text-muted hover:text-ink ${box}`}
        >
          <GroupMarker>
            <span className={expanded ? '' : '-rotate-90'}>
              <ChevronIcon />
            </span>
          </GroupMarker>
          <span className="shrink-0">{GROUP_LABELS.dealt_with}</span>
          <TileCount count={props.views.length} />
          {expanded ? (
            <span aria-hidden="true" className="mx-1.5 h-px flex-1 bg-hairline" />
          ) : (
            <span className="mx-1.5 min-w-0 flex-1 truncate font-normal text-hint">{firstTitle}</span>
          )}
          <span className="shrink-0 text-[11px] font-normal text-hint group-hover:text-ink">{expanded ? 'Hide' : 'Show'}</span>
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
  const groups = useHeldPlace(props.selectedTileId, props.selectedTileId, gridGroups(tiles), tileId).filter((bucket) => bucket.items.length > 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 pt-[13px] shadow-[inset_0_1px_0_var(--hairline)]">
        {/* Only the count: the Unread group's label right below already says how many are unread. */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-ink-2">Tiles</span>
          <span className="flex items-baseline gap-[5px] text-[11px] text-faint">
            <TileCount count={tiles.length} />
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
        <TopicActions detail={props.detail} />
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
