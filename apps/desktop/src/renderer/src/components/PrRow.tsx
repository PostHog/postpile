import type { PrSummary } from '@postpile/core';
import { useViewer } from '../api/viewer.ts';
import { assigneeLine } from '../lib/assignees.ts';
import { LIFECYCLE_WORDS, rowStateWord } from '../lib/pr.ts';
import type { StackPlace } from '../lib/stacks.ts';
import { prNumber } from '../lib/tiles.ts';
import { AssignedTo } from './AssignedTo.tsx';
import { Avatar } from './Avatar.tsx';
import { Glyph, PrStateIcon } from './icons.tsx';
import { ForWhomChip, UnreadDot, RepoLabel, StackMark, StateWordLabel } from './pills.tsx';

interface PrRowProps {
  pr: PrSummary;
  /** In a tile, or in the detail pane's PR list: same layout and facts, only the surface differs (quieter titles there). */
  place: 'tile' | 'detail';
  /** This PR is open in the detail pane. */
  selected: boolean;
  /** Done tiles grey the title and the thread count; the state icon and word keep their color. */
  greyed: boolean;
  /** A member of a stack or set: rounded row inside the tinted group box. */
  grouped: boolean;
  /** Show the row's own "for whom" chip: only when it differs from the tile's. */
  showForWhom: boolean;
  /** Where the PR sits in a GitHub stack; null for a lone PR (no mark). */
  stackPlace: StackPlace | null;
  /** Off on a single-PR tile: the tile's heading already is the PR's title. */
  showTitle: boolean;
  /** The PR is unread (core `TileView.unreadPrKeys`): coral dot hanging in the row's left padding. */
  unread: boolean;
  onClick: () => void;
}

function rowBackground(props: PrRowProps, quiet: boolean): string {
  if (props.place === 'detail') {
    if (props.selected) {
      return 'bg-surface shadow-picked';
    }
    return quiet ? 'bg-segment hover:bg-chip' : 'hover:bg-surface/70';
  }
  // The picked row lifts out of the selected tile's blue group: white with an accent ring.
  if (props.selected) {
    return 'bg-surface shadow-picked-in-tile';
  }
  if (props.grouped) {
    return quiet ? 'bg-segment hover:bg-chip' : 'hover:bg-surface';
  }
  return 'bg-surface hover:bg-subtle';
}

function titleLook(props: PrRowProps, greyed: boolean): string {
  // The detail pane's list sits under the tile it repeats, so its titles stay medium; the open one goes bold.
  if (props.place === 'detail') {
    if (props.selected) {
      return 'font-semibold text-ink';
    }
    return greyed ? 'font-medium text-muted' : 'font-medium text-ink';
  }
  // Titles are bold like in the 3a design; greyed rows step down to medium.
  if (greyed) {
    return 'font-medium text-muted';
  }
  if (props.pr.provenance.kind === 'pulled_in' && !props.selected) {
    return 'font-semibold tracking-[-0.005em] text-ink-2';
  }
  return 'font-semibold tracking-[-0.005em] text-ink';
}

/**
 * One PR line, in a tile and in the detail pane's PR list (3a design): state
 * icon in a 20px slot, number, the stack mark for a stack layer
 * ("1/3"), title (not on a single-PR tile, whose heading is the title), then
 * the state word (review state, or the DRAFT chip, Merged, Closed), open
 * threads and the author, then "assigned to" when someone else is assigned
 * (an agent PR a bot opened for a person names that person). No CI here: checks only show in the detail
 * pane's facts. Drafts and closed layers sit on a grey row so they stay in
 * their stack without drawing the eye. The coral dot of an unread PR hangs in
 * the row's left padding, so read and unread rows start their number and
 * title at the same x.
 */
export function PrRow(props: PrRowProps) {
  const { pr } = props;
  const lifecycle = pr.status.lifecycle;
  const quiet = lifecycle === 'draft' || lifecycle === 'closed';
  const greyed = props.greyed || quiet;
  // Grouped rows sit 3px inside their box, a lone row 1px (the box's border): 2px more padding puts the icon at the same x.
  const shape = props.grouped ? 'rounded-pr-row px-3' : 'px-3.5';
  const word = rowStateWord(pr.status);
  const viewerLogin = useViewer().data?.login ?? null;
  const assigned = assigneeLine(pr.author, pr.assignees, viewerLogin);
  // The detail pane's list (an @container) keeps its titles readable when the pane is narrow: below 480px
  // "assigned to" goes first (the body's "opened by" line still names the open PR's assignees), below 400px the author's face too.
  const assignedDrop = props.place === 'detail' ? '@max-[480px]:hidden' : '';
  const avatarDrop = props.place === 'detail' ? '@max-[400px]:hidden' : '';
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      title={props.showTitle ? undefined : pr.title}
      onClick={props.onClick}
      className={`flex h-8 min-w-0 items-center gap-2 text-left text-[12.5px] focus-visible:-outline-offset-2 ${shape} ${rowBackground(props, quiet)}`}
    >
      {/* The icon sits centered in a 20px slot (the detail header's kind icon has the same); the dot hangs left of it, in the padding. */}
      <span className="relative flex shrink-0 px-[3px]">
        {props.unread && <UnreadDot className="absolute top-1/2 -left-2 -translate-y-1/2" />}
        <PrStateIcon lifecycle={lifecycle} title={LIFECYCLE_WORDS[lifecycle].title} />
      </span>
      <span className="shrink-0 font-mono text-[11px] text-hint">#{prNumber(pr.key)}</span>
      {props.stackPlace && <StackMark place={props.stackPlace} greyed={props.greyed} />}
      {props.showTitle && <span className={`min-w-0 truncate ${titleLook(props, greyed)}`}>{pr.title}</span>}
      {props.showForWhom && <ForWhomChip forWhom={pr.forWhom} code={pr.why} provenance={pr.provenance} greyed={greyed} size="row" />}
      {pr.repoLabel && <RepoLabel label={pr.repoLabel} />}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-1">
        {word && <StateWordLabel word={word} />}
        {pr.openThreads > 0 && (
          <span
            title={`${pr.openThreads} open review thread${pr.openThreads === 1 ? '' : 's'}`}
            className={`flex items-center gap-[3px] font-mono text-[11px] ${greyed ? 'text-hint' : 'text-muted'}`}
          >
            <Glyph glyph="bubble" size={12} strokeWidth={1.6} />
            {pr.openThreads}
          </span>
        )}
        <Avatar login={pr.author} className={avatarDrop} />
        {assigned && <AssignedTo line={assigned} className={assignedDrop} />}
      </span>
    </button>
  );
}
