import type { ForWhom, PrSet, TilePerson, TileView, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { ageLabel } from '../lib/time.ts';
import { kindLabel, leadPr, tileForYou, tileUpdatedAt } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { personTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
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

function frameClasses(props: TileProps): string {
  if (props.selected) {
    return 'border-[1.5px] border-accent shadow-selected';
  }
  if (props.filterMatch === true) {
    return 'border border-match-line shadow-tile';
  }
  if (props.view.state.kind === 'done') {
    return 'border border-hairline-done';
  }
  return 'border border-hairline-strong shadow-tile';
}

/** The left band per "for whom": honey for you, sea for your team, neutral for your own PR, none else. */
const BANDS: Record<ForWhom['kind'], string | null> = {
  you: 'bg-honey',
  team: 'bg-sea',
  own: 'bg-muted',
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

/** One unit of attention: a single PR, a stack or a set. Done tiles go flat and grey. */
export function Tile(props: TileProps) {
  const actions = useActions();
  const now = useNow();
  const { view } = props;
  const { tile, state } = view;
  const done = state.kind === 'done';
  const unread = state.kind === 'unread';
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
    <article className={`relative flex min-w-0 flex-col rounded-tile ${background} ${frameClasses(props)} ${fade}`}>
      {props.selected && (
        // The notch points at the detail pane, which shows this tile.
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -right-[7px] z-10 -mt-1.5 size-3 rotate-45 border-t-[1.5px] border-r-[1.5px] border-accent ${background}`}
        />
      )}
      {BANDS[view.forWhom.kind] && (
        // The "for whom" band down the left edge, in the chip's color; grey on done tiles.
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 z-[1] w-1 rounded-l-[11px] ${done ? 'bg-ghost' : BANDS[view.forWhom.kind]}`} />
      )}
      {unread && <UnreadStrip view={view} />}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3.5 pt-3 pb-3">
        <div className="flex cursor-pointer flex-col gap-2" onClick={selectLead}>
          <div className="flex items-center gap-[7px]">
            <ForWhomChip forWhom={view.forWhom} code={view.why} greyed={done} />
            <span className={`shrink-0 text-[11px] ${props.selected ? 'font-medium text-accent' : 'text-muted'}`}>{kindLabel(view)}</span>
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
          <h2 className={`text-[14.5px] leading-snug font-semibold tracking-[-0.01em] ${done ? 'text-muted' : 'text-ink'}`}>{tile.title}</h2>
          {view.pendingWrite && (
            <div className="flex">
              <PendingWritePill pending={view.pendingWrite} />
            </div>
          )}
          {forYou && <p className={`line-clamp-3 text-[12.5px] leading-[1.45] ${done ? 'text-faint' : 'text-ink-2'}`}>{forYou}</p>}
        </div>
        <div className={`flex flex-col overflow-hidden rounded-row border ${props.selected ? 'border-accent-line' : 'border-pill-line'}`}>
          {view.prs.map((pr, index) => (
            <PrRow
              key={pr.key}
              pr={pr}
              first={index === 0}
              selected={props.selected && pr.key === props.selectedPrKey}
              strong={unread && pr.key === lead?.key}
              greyed={done}
              onClick={() => props.onSelect(pr.key)}
            />
          ))}
        </div>
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
