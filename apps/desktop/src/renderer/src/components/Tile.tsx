import type { ForWhom, PrSet, TilePerson, TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useNextAutoSyncAt } from '../api/live.ts';
import { glanceStateText } from '../lib/glance.ts';
import { updatingNow } from '../lib/staleness.ts';
import { ageLabel } from '../lib/time.ts';
import { stackPlaces } from '../lib/stacks.ts';
import { isDraftTile, kindLabel, leadPr, sameForWhom, tileForYou, tileUpdatedAt } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { personTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';
import { Button, buttonClasses } from './Button.tsx';
import { KindIcon } from './icons.tsx';
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

/** Drafts get a dashed frame (selection keeps its solid accent line). */
function frameClasses(props: TileProps, draft: boolean): string {
  const dashed = draft ? 'border-dashed' : '';
  if (props.selected) {
    return 'border-[1.5px] border-accent shadow-selected';
  }
  if (props.filterMatch === true) {
    return `border border-match-line shadow-tile ${dashed}`;
  }
  if (props.view.state.kind === 'done') {
    return `border border-hairline-done ${dashed}`;
  }
  return draft ? 'border border-dashed border-frame' : 'border border-hairline-strong shadow-tile';
}

/** The left band per "for whom": honey for you, sea for your team, neutral for your own PR, none else. */
const BANDS: Record<ForWhom['kind'], string | null> = {
  you: 'bg-honey',
  team: 'bg-sea',
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
  own: 'var(--color-muted)',
  none: null,
};

function dashedBand(color: string): { backgroundImage: string } {
  return { backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0 5px, transparent 5px 9px)` };
}

/** The people involved as a small overlapping stack of avatars. */
function PeopleStack(props: { people: TilePerson[] }) {
  return (
    <span className="flex shrink-0 pl-[5px]">
      {props.people.map((person) => (
        <span key={person.login} title={personTitle(person.login, person.role)} className="-ml-[5px] rounded-full">
          <Avatar login={person.login} size="md" className="ring-2 ring-surface" />
        </span>
      ))}
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
  const box = grouped
    ? `gap-0.5 p-[3px] ${props.selected ? 'bg-accent-soft' : 'bg-subtle'} border ${props.selected ? 'border-accent-line' : 'border-hairline-soft'}`
    : `overflow-hidden border ${props.selected ? 'border-accent-line' : 'border-pill-line'}`;
  return (
    <div className={`flex flex-col rounded-row ${box}`}>
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
  if (done || draft) {
    titleLook = 'font-medium text-muted';
  }
  const lead = leadPr(view);
  const nextAutoSyncAt = useNextAutoSyncAt();
  const glanceText = lead ? glanceStateText({ state: lead.glanceState, gap: lead.glanceGap, nextAutoSyncAt, now }) : null;
  const glanceUpdating = updatingNow({ syncing: actions.syncing, writing: lead?.glanceState === 'writing' });
  const forYou = tileForYou(view, props.sets);
  const updatedAt = tileUpdatedAt(view);
  const background = done ? 'bg-done' : props.filterMatch === true ? 'bg-warm-strip' : 'bg-surface';
  // A filter never hides a tile of the open topic; the ones it does not match fade.
  const fade = props.filterMatch === false ? 'opacity-45 hover:opacity-80' : '';
  const menuPrKey = props.selected ? props.selectedPrKey : (lead?.key ?? null);
  const yourMove = view.turn.kind === 'you' && !done;
  const footer = yourMove ? 'border-t border-move-line bg-move' : `border-t ${done ? 'border-hairline-done' : 'border-hairline-soft'}`;
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
          className={`absolute top-1/2 -right-[7px] z-10 -mt-1.5 size-3 rotate-45 border-t-[1.5px] border-r-[1.5px] border-accent ${background}`}
        />
      )}
      {BANDS[view.forWhom.kind] && (
        // The "for whom" band down the left edge, in the chip's color; grey on
        // done tiles, striped on drafts. A 4px strip cannot follow the tile's
        // 12px corner by itself, so it sits in a full-size layer clipped to the
        // tile's inner rounding (12px minus the frame) and follows the curve.
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-[10.5px]">
          {draft ? (
            <span
              className="absolute inset-y-0 left-0 w-1"
              style={dashedBand(done ? 'var(--color-ghost)' : (DASHED_BANDS[view.forWhom.kind] ?? ''))}
            />
          ) : (
            <span className={`absolute inset-y-0 left-0 w-1 ${done ? 'bg-ghost' : BANDS[view.forWhom.kind]}`} />
          )}
        </span>
      )}
      {unread && <UnreadStrip view={view} />}
      {!unread && <UnseenMergeStrip view={view} />}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3.5 pt-3 pb-3">
        <div className="flex cursor-pointer flex-col gap-2" onClick={selectLead}>
          <div className="flex items-center gap-[7px]">
            <ForWhomChip forWhom={view.forWhom} code={view.why} greyed={done} />
            <span className={`flex shrink-0 items-center gap-[5px] text-[12px] ${props.selected ? 'font-medium text-accent' : 'text-muted'}`}>
              {tile.kind !== 'single' && <KindIcon kind={tile.kind} size={13} />}
              {kindLabel(view)}
            </span>
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
            {!unread && updatedAt && <span className="shrink-0 font-mono text-[10.5px] text-faint">{ageLabel(updatedAt, now)}</span>}
          </div>
          <h2 className={`text-[14.5px] leading-snug tracking-[-0.01em] ${titleLook}`}>{tile.title}</h2>
          {view.pendingWrite && (
            <div className="flex">
              <PendingWritePill pending={view.pendingWrite} />
            </div>
          )}
          {forYou && <p className={`line-clamp-3 text-[12.5px] leading-[1.45] ${done ? 'text-faint' : 'text-ink-2'}`}>{forYou}</p>}
        </div>
        <PrRows {...props} done={done} />
      </div>
      <div className={`mt-auto flex min-h-[46px] items-center gap-2 rounded-b-[11px] px-3.5 ${footer}`}>
        <TurnLine turn={view.turn} greyed={done} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {footerAction === 'open' && <Button onClick={selectLead}>Open</Button>}
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
          {view.offers.snooze && <SnoozeMenu tileId={tile.id} snoozed={state.kind === 'snoozed'} variant={footerAction === 'snooze' ? 'primary' : 'secondary'} />}
          {github && (
            <a href={github.filesTab ? filesTabUrl(github.url) : github.url} target="_blank" rel="noreferrer" title="Opens the PR on github.com" className={buttonClasses('secondary', 'sm')}>
              {github.label}
            </a>
          )}
          <TileMenu view={view} topics={props.topics} prKey={menuPrKey} />
        </div>
      </div>
    </article>
  );
}
