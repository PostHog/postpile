import type { ForWhom, PrSet, TilePerson, TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useNextAutoSyncAt } from '../api/live.ts';
import { glanceStateText } from '../lib/glance.ts';
import { updatingNow } from '../lib/staleness.ts';
import { ageLabel } from '../lib/time.ts';
import { stackPlaces } from '../lib/stacks.ts';
import { isDraftTile, kindParts, leadPr, sameForWhom, tileForYou, tileUpdatedAt } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { personTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';
import { Button, buttonClasses } from './Button.tsx';
import { ExternalIcon, KindIcon } from './icons.tsx';
import { ForWhomChip, PendingWritePill, RepoLabel, VerdictPill } from './pills.tsx';
import { PrRow } from './PrRow.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { TileMenu } from './TileMenu.tsx';
import { TurnLine } from './TurnLine.tsx';
import { UnreadStrip, UnseenMergeStrip } from './UnreadStrip.tsx';
import { markReadNote } from '../lib/guard.ts';
import { filesTabUrl } from '../lib/key-files.ts';

interface TileProps {
  view: TileView;
  sets: PrSet[];
  topics: TopicListItem[];
  selected: boolean;
  /** The PR open in the detail pane, when this tile is selected. */
  selectedPrKey: string | null;
  onSelect: (prKey: string) => void;
  /** With a queue filter on: true stands out warm, false fades. Null without a filter. */
  filterMatch: boolean | null;
}

/**
 * The resting tile has no border: its hairline is a ring inside `shadow-tile`.
 * Selection, filter matches, done tiles and drafts (dashed) keep a real border.
 */
function frameClasses(props: TileProps, draft: boolean): string {
  const dashed = draft ? 'border-dashed' : '';
  if (props.selected) {
    return 'border border-accent shadow-selected';
  }
  if (props.filterMatch === true) {
    return `border border-match-line shadow-tile-lift ${dashed}`;
  }
  if (props.view.state.kind === 'done') {
    return `border border-hairline-done ${dashed}`;
  }
  return draft ? 'border border-dashed border-frame' : 'shadow-tile';
}

/** Only the resting tile draws its edge as a ring; everything else has a 1px border. */
function hasBorder(props: TileProps, draft: boolean): boolean {
  return props.selected || props.filterMatch === true || props.view.state.kind === 'done' || draft;
}

/** The left band per "for whom": honey for you, sea for your home team, neutral for your own PR, none else (a routing team too). */
const BANDS: Record<ForWhom['kind'], string | null> = {
  you: 'bg-honey',
  team: 'bg-sea',
  routing: null,
  own: 'bg-muted',
  none: null,
};

/**
 * The same band, dashed, on drafts: the colour of the solid band as stripes.
 * Drawn as a background inside the same rounded shape, so the dashes follow
 * the tile's corners and never sit on top of the frame (a dashed border did).
 */
const DASHED_BANDS: Record<ForWhom['kind'], string | null> = {
  you: 'var(--color-honey)',
  team: 'var(--color-sea)',
  routing: null,
  own: 'var(--color-muted)',
  none: null,
};

function dashedBand(color: string): { backgroundImage: string } {
  return { backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0 5px, transparent 5px 9px)` };
}

/** The people involved as a small overlapping stack of avatars. */
function PeopleStack(props: { people: TilePerson[] }) {
  return (
    <span className="flex shrink-0 pl-1">
      {props.people.map((person) => (
        <span key={person.login} title={personTitle(person.login, person.role)} className="-ml-1 rounded-full">
          <Avatar login={person.login} size="mid" className="shadow-face" />
        </span>
      ))}
    </span>
  );
}

/** "Set · 2" next to the chips: blue on the selected tile, grey otherwise. */
function KindLabel(props: { view: TileView; selected: boolean }) {
  const { word, count } = kindParts(props.view);
  const kind = props.view.tile.kind;
  return (
    <span className={`flex shrink-0 items-center gap-[5px] text-[12px] ${props.selected ? 'font-medium text-accent' : 'text-muted'}`}>
      {kind !== 'single' && <KindIcon kind={kind} size={12} />}
      <span>{word}</span>
      {count !== null && (
        <>
          <span className={props.selected ? 'text-set-sep' : 'text-ghost'}>·</span>
          <span className="font-mono text-[11px] font-semibold tabular-nums">{count}</span>
        </>
      )}
    </span>
  );
}

/**
 * The tile's PR rows. One PR: a white bordered box without the title (the
 * tile's heading is the title). A stack or set: one tinted box with rounded
 * member rows, the selected one highlighted. A PR that keeps the tile from
 * being done gets the coral dot (core `TileView.notDonePrKeys`).
 */
function PrRows(props: TileProps & { done: boolean }) {
  const { view } = props;
  const grouped = view.prs.length > 1;
  const places = stackPlaces(view.tile.stacks);
  // Grouped rows sit 3px inside the box, so its edge can be an inset ring; a lone row would cover one.
  const box = grouped
    ? `gap-0.5 rounded-group p-[3px] inset-ring ${props.selected ? 'bg-group-selected inset-ring-edge-accent-group' : 'bg-subtle inset-ring-hairline-soft'}`
    : `overflow-hidden rounded-row border ${props.selected ? 'border-accent-line' : 'border-pill-line'}`;
  return (
    <div className={`flex flex-col ${box}`}>
      {view.prs.map((pr) => (
        <PrRow
          key={pr.key}
          pr={pr}
          grouped={grouped}
          showForWhom={grouped && !sameForWhom(pr.forWhom, view.forWhom)}
          stackPlace={places.get(pr.key) ?? null}
          showTitle={grouped}
          notDone={view.notDonePrKeys.includes(pr.key)}
          selected={props.selected && pr.key === props.selectedPrKey}
          greyed={props.done}
          onClick={() => props.onSelect(pr.key)}
        />
      ))}
    </div>
  );
}

/** One unit of attention: a single PR, a stack or a set. Done tiles go flat and grey. */
export function Tile(props: TileProps) {
  const actions = useActions();
  const now = useNow();
  const { view } = props;
  const { tile, state } = view;
  const done = state.kind === 'done';
  const unread = state.kind === 'unread';
  const draft = isDraftTile(view);
  // Unread: bold, full ink. Read: regular weight, a notch quieter (the your-move footer stays the reminder). Done and drafts: muted.
  let titleLook = unread ? 'font-semibold text-ink' : 'font-normal text-ink-2';
  if (props.selected && !unread) {
    titleLook = 'font-medium text-ink';
  }
  if (done || draft) {
    titleLook = 'font-medium text-muted';
  }
  const lead = leadPr(view);
  const nextAutoSyncAt = useNextAutoSyncAt();
  const glanceText = lead ? glanceStateText({ state: lead.glanceState, gap: lead.glanceGap, nextAutoSyncAt, now }) : null;
  const glanceUpdating = updatingNow({ syncing: actions.syncing, writing: lead?.glanceState === 'writing' });
  const forYou = tileForYou(view, props.sets);
  const updatedAt = tileUpdatedAt(view);
  let background = 'bg-surface';
  if (done) {
    background = 'bg-done';
  } else if (props.selected) {
    background = 'bg-surface bg-(image:--bg-tile-selected)';
  } else if (props.filterMatch === true) {
    background = 'bg-warm-strip';
  }
  // A filter never hides a tile of the open topic; the ones it does not match fade.
  const fade = props.filterMatch === false ? 'opacity-45 hover:opacity-80' : '';
  const menuPrKey = props.selected ? props.selectedPrKey : (lead?.key ?? null);
  const yourMove = view.turn.kind === 'you' && !done;
  const footer = yourMove ? 'bg-move shadow-move-footer' : done ? 'shadow-[inset_0_1px_0_var(--hairline-done)]' : 'shadow-[inset_0_1px_0_var(--hairline-soft)]';
  const secondary = yourMove ? 'move' : 'secondary';
  // From core (`tileOffers`): never "Mark done" where a mark-read leaves the tile your move; read and still your move, Snooze leads.
  const footerAction = view.offers.footer;
  const markLabel = view.offers.markLabel;
  const github = view.offers.github;

  function selectLead() {
    if (lead) {
      props.onSelect(lead.key);
    }
  }

  return (
    <article className={`relative flex min-w-0 flex-col rounded-tile ${background} ${frameClasses(props, draft)} ${fade}`}>
      {props.selected && (
        // The notch points at the detail pane, which shows this tile.
        <span
          aria-hidden="true"
          className="absolute top-1/2 -right-[6.5px] z-10 -mt-[5.5px] size-[11px] rotate-45 rounded-tr-[2px] border-t border-r border-accent bg-surface"
        />
      )}
      {BANDS[view.forWhom.kind] && (
        // The "for whom" band down the left edge, in the chip's color; grey on
        // done tiles, striped on drafts. A 3px strip cannot follow the tile's
        // 12px corner by itself, so it sits in a full-size layer clipped to the
        // tile's inner rounding (12px minus the frame, if any) and follows the curve.
        <span aria-hidden="true" className={`pointer-events-none absolute inset-0 z-[1] overflow-hidden ${hasBorder(props, draft) ? 'rounded-[11px]' : 'rounded-tile'}`}>
          {draft ? (
            <span
              className="absolute inset-y-0 left-0 w-[3px]"
              style={dashedBand(done ? 'var(--color-ghost)' : (DASHED_BANDS[view.forWhom.kind] ?? ''))}
            />
          ) : (
            <span className={`absolute inset-y-0 left-0 w-[3px] ${done ? 'bg-ghost' : BANDS[view.forWhom.kind]}`} />
          )}
        </span>
      )}
      {unread && <UnreadStrip view={view} />}
      {!unread && <UnseenMergeStrip view={view} />}
      <div className="flex min-h-0 flex-1 flex-col gap-2 pt-3 pr-3.5 pb-[13px] pl-[15px]">
        <div className="flex cursor-pointer flex-col gap-2" onClick={selectLead}>
          <div className="flex items-center gap-[7px]">
            <ForWhomChip forWhom={view.forWhom} code={view.why} greyed={done} />
            <KindLabel view={view} selected={props.selected} />
            {draft && (
              <span
                title="A draft: nobody reviews or approves it yet, and it won't merge soon"
                className="flex h-5 shrink-0 items-center rounded-full bg-segment px-2 text-[10.5px] font-semibold text-muted"
              >
                Draft
              </span>
            )}
            <VerdictPill verdict={lead?.verdict ?? null} stale={lead?.glanceStale} updating={glanceUpdating} greyed={done} missing={glanceText} />
            {state.kind === 'snoozed' && <span className="text-[10.5px] font-medium text-muted">Snoozed</span>}
            {view.repoLabel && <RepoLabel label={view.repoLabel} />}
            {view.quietRepo && (
              <span className="shrink-0 text-[10.5px] text-hint" title="This repo is set to “Let it go stale” in the repo menu: still synced, never urgent, never pings">
                quiet repo
              </span>
            )}
            <span className="ml-auto" />
            <PeopleStack people={view.people} />
            {!unread && updatedAt && (
              <>
                <span aria-hidden="true" className="mx-px h-3 w-px shrink-0 bg-hairline" />
                <span className="min-w-4 shrink-0 text-right font-mono text-[10.5px] text-faint tabular-nums">{ageLabel(updatedAt, now)}</span>
              </>
            )}
          </div>
          <h2 className={`text-[14.5px] leading-[1.375] tracking-[-0.012em] text-balance ${titleLook}`}>{tile.title}</h2>
          {view.pendingWrite && (
            <div className="flex">
              <PendingWritePill pending={view.pendingWrite} />
            </div>
          )}
          {forYou && <p className={`line-clamp-3 text-[12.5px] leading-normal text-pretty ${done ? 'text-faint' : 'text-ink-2'}`}>{forYou}</p>}
        </div>
        <PrRows {...props} done={done} />
      </div>
      <div className={`mt-auto flex min-h-[46px] items-center gap-2 rounded-b-tile pr-3 pl-[15px] ${footer}`}>
        <TurnLine turn={view.turn} greyed={done} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {footerAction === 'open' && (
            <Button variant={secondary} onClick={selectLead}>
              Open
            </Button>
          )}
          {(footerAction === 'mark_read' || footerAction === 'mark_done') && (
            <Button
              variant="primary"
              title={
                view.pendingWrite
                  ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
                  : (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks every PR here read; GitHub follows after 6s')
              }
              disabled={view.pendingWrite !== null || actions.isBusy(`markRead:${tile.id}`)}
              onClick={() => void actions.markRead(tile.id, view.afterRead)}
            >
              {markLabel}
            </Button>
          )}
          {view.offers.snooze && <SnoozeMenu tileId={tile.id} snoozed={state.kind === 'snoozed'} variant={footerAction === 'snooze' ? 'primary' : secondary} />}
          {github && (
            <a href={github.filesTab ? filesTabUrl(github.url) : github.url} target="_blank" rel="noreferrer" title="Opens the PR on github.com" className={`${buttonClasses(secondary, 'sm')} gap-[5px]`}>
              {github.label}
              <ExternalIcon size={10} className="text-faint" />
            </a>
          )}
          <TileMenu view={view} topics={props.topics} prKey={menuPrKey} variant={secondary} />
        </div>
      </div>
    </article>
  );
}
