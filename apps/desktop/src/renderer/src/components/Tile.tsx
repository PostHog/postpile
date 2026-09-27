import type { PrSet, TileView, TopicListItem } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { ageLabel } from '../lib/time.ts';
import { kindLabel, leadPr, provenanceLine, tileForYou, tileUpdatedAt } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { KindIcon } from './icons.tsx';
import { VerdictPill } from './pills.tsx';
import { PrRow } from './PrRow.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { TileMenu } from './TileMenu.tsx';
import { UnreadStrip } from './UnreadStrip.tsx';

interface TileProps {
  view: TileView;
  sets: PrSet[];
  topics: TopicListItem[];
  selected: boolean;
  /** The PR open in the detail pane, when this tile is selected. */
  selectedPrKey: string | null;
  onSelect: (prKey: string) => void;
}

function frameClasses(props: TileProps): string {
  const kind = props.view.state.kind;
  if (props.selected) {
    return 'border-[1.5px] border-accent shadow-selected';
  }
  if (kind === 'unread') {
    return 'border border-unread-border shadow-tile';
  }
  if (kind === 'done') {
    return 'border border-hairline-done';
  }
  return 'border border-hairline shadow-tile';
}

/** One unit of attention: a single PR, a stack or a set. Done tiles go flat and grey. */
export function Tile(props: TileProps) {
  const actions = useActions();
  const now = useNow();
  const { view } = props;
  const { tile, state } = view;
  const done = state.kind === 'done';
  const lead = leadPr(view);
  const forYou = tileForYou(view, props.sets);
  const updatedAt = tileUpdatedAt(view);
  const background = done ? 'bg-done' : 'bg-surface';
  const menuPrKey = props.selected ? props.selectedPrKey : (lead?.key ?? null);

  function selectLead() {
    if (lead) {
      props.onSelect(lead.key);
    }
  }

  return (
    <article className={`relative flex flex-col rounded-tile ${background} ${frameClasses(props)}`}>
      {props.selected && (
        // The notch points at the detail pane, which shows this tile.
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -right-[7px] z-10 -mt-1.5 size-3 rotate-45 border-t-[1.5px] border-r-[1.5px] border-accent ${background}`}
        />
      )}
      {state.kind === 'unread' && <UnreadStrip view={view} />}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-3 pb-3">
        <div className="flex cursor-pointer flex-col gap-2.5" onClick={selectLead}>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-[5px] text-[11px] font-medium ${props.selected ? 'text-accent' : 'text-muted'}`}>
              <KindIcon kind={tile.kind} />
              {kindLabel(view)}
            </span>
            <VerdictPill verdict={lead?.verdict ?? null} stale={lead?.glanceStale} greyed={done} />
            {state.kind === 'snoozed' && <span className="text-[10.5px] font-medium text-muted">Snoozed</span>}
            <span className="ml-auto font-mono text-[10.5px] text-faint">{updatedAt ? ageLabel(updatedAt, now) : ''}</span>
          </div>
          <h2 className={`text-[14.5px] leading-snug font-semibold tracking-[-0.01em] ${done ? 'text-muted' : 'text-ink'}`}>{tile.title}</h2>
          {forYou && <p className={`text-[12.5px] leading-[1.45] ${done ? 'text-faint' : 'text-ink-2'}`}>{forYou}</p>}
        </div>
        <div className={`flex flex-col overflow-hidden rounded-row border ${props.selected ? 'border-accent-line' : 'border-hairline-soft'}`}>
          {view.prs.map((pr, index) => (
            <PrRow
              key={pr.key}
              pr={pr}
              first={index === 0}
              selected={props.selected && pr.key === props.selectedPrKey}
              strong={state.kind === 'unread' && pr.key === lead?.key}
              onClick={() => props.onSelect(pr.key)}
            />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-1.5">
          {done ? (
            <Button onClick={selectLead}>Open</Button>
          ) : (
            <Button
              variant="primary"
              title={actions.blockedReason('markRead') ?? 'Marks every PR here read; GitHub follows after 6s'}
              disabled={actions.isBusy(`markRead:${tile.id}`)}
              onClick={() => void actions.markRead(tile.id)}
            >
              {state.kind === 'unread' ? 'Mark read' : 'Mark done'}
            </Button>
          )}
          <SnoozeMenu tileId={tile.id} snoozed={state.kind === 'snoozed'} />
          <TileMenu view={view} topics={props.topics} prKey={menuPrKey} />
          <span className="ml-auto font-mono text-[10px] text-faint">{provenanceLine(view)}</span>
        </div>
      </div>
    </article>
  );
}
