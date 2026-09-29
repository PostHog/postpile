import type { ForWhom, PrSet, TilePerson, TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { ageLabel } from '../lib/time.ts';
import { stackPlaces } from '../lib/stacks.ts';
import { isDraftTile, kindLabel, leadPr, sameForWhom, tileForYou, tileUpdatedAt } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { personTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { KindIcon } from './icons.tsx';
import { ForWhomChip, PendingWritePill, RepoLabel, VerdictPill } from './pills.tsx';
import { PrRow } from './PrRow.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { TileMenu } from './TileMenu.tsx';
import { TurnLine } from './TurnLine.tsx';
import { UnreadStrip } from './UnreadStrip.tsx';
import { markReadNote } from '../lib/guard.ts';

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

/** The same band, dashed, on drafts. */
const DASHED_BANDS: Record<ForWhom['kind'], string | null> = {
  you: 'border-honey',
  team: 'border-sea',
  own: 'border-muted',
  none: null,
};

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
 * The tile's PR rows. One PR: a white bordered box. A stack or set: one
 * tinted box with rounded member rows, the selected one highlighted.
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
  // Unread: full ink. Read: a notch quieter. Done and drafts: muted.
  let titleLook = unread ? 'font-semibold text-ink' : 'font-semibold text-ink-2';
  if (done || draft) {
    titleLook = 'font-medium text-muted';
  }
  const lead = leadPr(view);
  const forYou = tileForYou(view, props.sets);
  const updatedAt = tileUpdatedAt(view);
  const background = done ? 'bg-done' : props.filterMatch === true ? 'bg-warm-strip' : 'bg-surface';
  // A filter never hides a tile of the open topic; the ones it does not match fade.
  const fade = props.filterMatch === false ? 'opacity-45 hover:opacity-80' : '';
  const menuPrKey = props.selected ? props.selectedPrKey : (lead?.key ?? null);
  const yourMove = view.turn.kind === 'you' && !done;
  const footer = yourMove ? 'border-t border-move-line bg-move' : `border-t ${done ? 'border-hairline-done' : 'border-hairline-soft'}`;

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
      {BANDS[view.forWhom.kind] && !draft && (
        // The "for whom" band down the left edge, in the chip's color; grey on done tiles.
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 z-[1] w-1 rounded-l-[11px] ${done ? 'bg-ghost' : BANDS[view.forWhom.kind]}`} />
      )}
      {DASHED_BANDS[view.forWhom.kind] && draft && (
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 z-[1] w-1 border-l-4 border-dashed ${done ? 'border-ghost' : DASHED_BANDS[view.forWhom.kind]}`} />
      )}
      {unread && <UnreadStrip view={view} />}
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
            <VerdictPill verdict={lead?.verdict ?? null} stale={lead?.glanceStale} greyed={done} gap={lead?.glanceGap} />
            {state.kind === 'snoozed' && <span className="text-[10.5px] font-medium text-muted">Snoozed</span>}
            {view.repoLabel && <RepoLabel label={view.repoLabel} />}
            {view.quietRepo && (
              <span className="shrink-0 text-[10.5px] text-faint" title="This repo is set to “Let it go stale” in the repo menu: still synced, never urgent, never pings">
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
          {done ? (
            <Button onClick={selectLead}>Open</Button>
          ) : (
            <Button
              variant="primary"
              title={
                view.pendingWrite
                  ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
                  : (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks every PR here read; GitHub follows after 6s')
              }
              disabled={view.pendingWrite !== null || actions.isBusy(`markRead:${tile.id}`)}
              onClick={() => void actions.markRead(tile.id)}
            >
              {unread ? 'Mark read' : 'Mark done'}
            </Button>
          )}
          <SnoozeMenu tileId={tile.id} snoozed={state.kind === 'snoozed'} />
          <TileMenu view={view} topics={props.topics} prKey={menuPrKey} />
        </div>
      </div>
    </article>
  );
}
