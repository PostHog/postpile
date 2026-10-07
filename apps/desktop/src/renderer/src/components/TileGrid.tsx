import { useRef, type ReactNode } from 'react';
import { TopicActions } from './AgentActions.tsx';
import { TopicArchiveBox } from './TopicArchiveBox.tsx';
import type { TileGroup, TileView, TopicDetail, TopicListItem } from '@postpile/core';
import { gridGroups, headingGroup } from '../lib/queues.ts';
import { useFlip } from '../lib/use-flip.ts';
import { useHeldPlace } from '../lib/use-held-place.ts';
import { useSettling } from '../lib/use-settling.ts';
import { Crossfade } from './Crossfade.tsx';
import { Fold } from './Fold.tsx';
import { ChevronIcon, Glyph } from './icons.tsx';
import { UnreadDot } from './pills.tsx';
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
  /** Core's per-group your-move counts match what the groups show: no search filter, no tile held outside its group. */
  showYourMove: boolean;
}

/** Group names on screen. "Dealt with" is the tile state `done`; a topic with nothing left goes to the Archive. */
const GROUP_LABELS: Record<TileGroup, string> = { unread: 'Unread', open: 'Open', dealt_with: 'Dealt with' };

function TileCount(props: { count: number }) {
  return <span className="font-mono text-[10.5px] font-semibold text-hint tabular-nums">{props.count}</span>;
}

/**
 * "· 1 PR open" after the Tiles count: open PRs that sit only in Dealt with
 * tiles (core's `TopicDetail.openInDealtWith`). They are why the Archive box
 * does not show. Nothing at 0.
 */
function OpenInDealtWithHint(props: { openIn: TopicDetail['openInDealtWith'] }) {
  if (props.openIn.length === 0) {
    return null;
  }
  const names = props.openIn.map((pr) => `${pr.label}${pr.isDraft ? ' (draft)' : ''}`).join(', ');
  const title = `Still open: ${names}. The topic moves to the Archive once every PR is merged or closed.`;
  return (
    <>
      <span className="text-ghost">·</span>
      <span title={title}>
        {props.openIn.length} {props.openIn.length === 1 ? 'PR' : 'PRs'} open
      </span>
    </>
  );
}

/**
 * "· 2 your move" after the count, in the honey of the sidebar's chip; core
 * counts it (`TopicDetail.groupYourMoves`). Nothing at 0, and nothing while
 * the search filters the grid or a held tile sits outside its core group:
 * the count is for the groups as core sees them.
 */
function YourMoveCount(props: { count: number }) {
  if (props.count === 0) {
    return null;
  }
  return (
    <span className="font-semibold text-honey-ink">
      <span aria-hidden="true">· </span>
      <span className="font-mono text-[10.5px] tabular-nums">{props.count}</span> your move
    </span>
  );
}

/**
 * Tiles in one column, never side by side: the selected tile's notch then
 * always points straight at the detail pane.
 */
function Grid(props: TileGridProps & { group: TileGroup; views: TileView[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      {props.views.map((view) => (
        <Tile
          key={view.tile.id}
          shownGroup={props.group}
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

/**
 * Unread's coral dot, which ripples out like every unread dot when the
 * heading stops saying Unread, and the grey check of Dealt with, which
 * fades in with the heading's new word (+160ms). Open has no marker.
 */
function GroupMarkers(props: { shown: TileGroup; topicId: string }) {
  const check = props.shown === 'dealt_with' ? 'scale-100 opacity-100' : 'scale-60 opacity-0';
  return (
    <GroupMarker>
      <span className="grid place-items-center">
        <UnreadDot shown={props.shown === 'unread'} halo={false} dotKey={`group:${props.topicId}`} className="col-start-1 row-start-1" />
        <span
          aria-hidden="true"
          className={`col-start-1 row-start-1 flex text-faint transition-[opacity,scale] delay-160 duration-220 ease-out motion-reduce:transition-none ${check}`}
        >
          <Glyph glyph="check" size={10} strokeWidth={2} />
        </span>
      </span>
    </GroupMarker>
  );
}

/**
 * Unread or Open: the name and count sit right on top of the group's first
 * tile. The name follows `headingGroup`: once the held tile under "Unread"
 * is read, the word changes in place to the group it went to (+160ms).
 */
function GroupSection(props: TileGridProps & { group: TileGroup; views: TileView[] }) {
  const shown = headingGroup(
    props.group,
    props.views.map((view) => view.group),
  );
  return (
    <section className="flex flex-col gap-2">
      {/* 16px in: the tile's 15px padding plus its 1px frame. */}
      <h3 data-flip-key={`group:${props.group}`} className="relative flex items-baseline gap-1.5 pl-4 text-[11.5px] leading-[normal] font-semibold text-ink-2">
        <GroupMarkers shown={shown} topicId={props.detail.topic.id} />
        <Crossfade swapKey={shown} animate enterClass="animate-word-in" leaveClass="animate-word-out">
          <span className={shown === 'unread' ? '' : 'text-hint'}>{GROUP_LABELS[shown]}</span>
        </Crossfade>
        <TileCount count={props.views.length} />
        <YourMoveCount count={props.showYourMove ? props.detail.groupYourMoves[props.group] : 0} />
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
      <h3 data-flip-key="group:dealt_with">
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
      {expanded && <Grid {...props} group="dealt_with" />}
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
 * on", `useHeldPlace`); its look changes right away. When it then takes its
 * new place, or a sync moves a tile, the tiles and headings in between slide
 * there and the moved tile lights up briefly (`useFlip`, "Marked when the
 * dwell ends").
 */
/**
 * The topic's action row and its Archive box, each in a `Fold` with its
 * spacing inside, so a fold with nothing in it takes no room. When the
 * last read lands, the action row gives way and the box grows into its
 * place at +320ms; its "Archive now" then rises in (`arrived`). Keyed by
 * topic by the caller: another topic just shows its own.
 */
function TopicBoxes(props: { detail: TopicDetail }) {
  const hasActions = props.detail.agent.approve !== null || props.detail.agent.markRead !== null;
  const hasArchive = props.detail.archive !== null;
  const arrived = useSettling(hasArchive);
  const timing = 'delay-320 duration-320 ease-[cubic-bezier(.3,.7,.2,1)]';
  return (
    <>
      <Fold open={hasActions} className={timing}>
        <div className="pt-3">
          <TopicActions detail={props.detail} />
        </div>
      </Fold>
      <Fold open={hasArchive} className={timing}>
        <div className="pt-3">
          <TopicArchiveBox detail={props.detail} arrived={arrived} />
        </div>
      </Fold>
    </>
  );
}

export function TileGrid(props: Omit<TileGridProps, 'showYourMove'>) {
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, { landed: true });
  const matching = props.matchingTileIds;
  const tiles = matching ? props.detail.tiles.filter((view) => matching.has(view.tile.id)) : props.detail.tiles;
  const groups = useHeldPlace(props.selectedTileId, props.selectedTileId, gridGroups(tiles), tileId).filter((bucket) => bucket.items.length > 0);
  // A held tile shows in a group other than its core one; core's counts would then disagree with the headings.
  const held = groups.some((bucket) => bucket.items.some((view) => view.group !== bucket.key));
  const showYourMove = matching === null && !held;
  return (
    <div ref={listRef} className="flex flex-col gap-5">
      <div className="flex flex-col pt-[13px] shadow-[inset_0_1px_0_var(--hairline)]">
        {/* Only the count: the Unread group's label right below already says how many are unread. */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-ink-2">Tiles</span>
          <span className="flex items-baseline gap-[5px] text-[11px] text-faint">
            <TileCount count={tiles.length} />
            <OpenInDealtWithHint openIn={props.detail.openInDealtWith} />
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
        <TopicBoxes key={props.detail.topic.id} detail={props.detail} />
      </div>
      {tiles.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">
          {matching !== null ? 'No tile here matches the filter.' : 'Nothing in this topic pinged you.'}
        </p>
      )}
      {groups.map((bucket) =>
        bucket.key === 'dealt_with' ? (
          <DealtWithGroup key={bucket.key} {...props} showYourMove={showYourMove} views={bucket.items} />
        ) : (
          <GroupSection key={`${props.detail.topic.id}:${bucket.key}`} {...props} showYourMove={showYourMove} group={bucket.key as TileGroup} views={bucket.items} />
        ),
      )}
    </div>
  );
}
