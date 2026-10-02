import { useRef, useState, type ReactNode } from 'react';
import type { TopicListItem, TopicPerson, TopicSection, ViewerView } from '@postpile/core';
import { useTools } from '../api/tools.ts';
import { useFinishedTopics } from '../api/topics.ts';
import { statusLabel } from '../lib/memory.ts';
import { bucketItems, sidebarBuckets, topicRowId, unreadLook, type QueueFilter } from '../lib/queues.ts';
import { useFlip } from '../lib/use-flip.ts';
import { useHeldPlace } from '../lib/use-held-place.ts';
import { type SearchFilter } from '../lib/search.ts';
import { stateMix } from '../lib/pr-mix.ts';
import { sectionLook } from '../lib/sections.ts';
import { areaFolds, foldedSummary, isNotSorted, otherTopicsGroups, rowsWhileFolded, startsOpen, type AreaFold } from '../lib/sidebar.ts';
import { ageLabel, whenLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { teamPill } from '../lib/faces.ts';
import { UnreadDot } from './pills.tsx';
import { Avatar } from './Avatar.tsx';
import { BellIcon, CheckIcon, ChevronIcon, InboxIcon, InstructionsIcon, PeopleIcon, PrStateIcon } from './icons.tsx';
import { QueueFilters } from './QueueFilters.tsx';
import { YourMoveChip } from './YourMoveChip.tsx';
import { InboxCleanup } from './InboxCleanup.tsx';

/**
 * The "what's going on" snippet under the name: the dossier summary, else its
 * short state line, else tile counts.
 */
function topicSnippet(item: TopicListItem): string {
  if (item.topic.summary) {
    return item.topic.summary;
  }
  if (item.statusLine) {
    return item.statusLine.note ? item.statusLine.note : statusLabel(item.statusLine.status);
  }
  return `${item.openTiles} open · ${item.totalTiles} tiles`;
}

/**
 * The row's one number: unread tiles, in a small bubble (the dots stay per PR). Coral while an unread
 * tile is still open (the urgency rule), grey when every unread tile is merged
 * or closed. Nothing when all is read.
 */
function UnreadBubble(props: { item: TopicListItem }) {
  const look = unreadLook(props.item);
  const count = props.item.unreadTiles;
  if (look === null) {
    return null;
  }
  const label = look === 'urgent' ? `${count} unread ${count === 1 ? 'tile' : 'tiles'}` : `${count} unread, merged or closed since you looked`;
  const tint = look === 'urgent' ? 'bg-unread text-on-ink' : 'bg-chip text-muted';
  return (
    <span
      title={label}
      aria-label={label}
      className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-[5px] font-mono text-[10px] leading-none font-semibold tabular-nums shadow-bubble ${tint}`}
    >
      {count}
    </span>
  );
}

/** The row's background decides the face rings: they cut the overlaps in the row's own color. */
type RowTone = 'active' | 'unread' | 'read';

const FACE_RINGS: Record<RowTone, string> = {
  active: 'ring-surface',
  unread: 'ring-warm-row',
  read: 'ring-sidebar',
};

/**
 * Up to three faces (`TopicListItem.people`, PR authors only). You and your
 * teammates sit together in the team pill (sea tint, a sea inset ring, the
 * people icon first); the other authors follow outside it as plain avatars,
 * overlapping like the faces inside (the first one onto the pill's edge).
 */
function FaceStack(props: { people: TopicPerson[]; tone: RowTone }) {
  const ring = FACE_RINGS[props.tone];
  const pill = teamPill(props.people);
  return (
    <span className="flex shrink-0 items-center">
      {pill.ours.length > 0 && (
        <span title={pill.title} className="flex h-[22px] items-center rounded-full bg-sea-soft pr-0.5 pl-1.5 text-sea-ink inset-ring inset-ring-sea-ring">
          <PeopleIcon size={11} />
          <span className="flex pl-[7px]">
            {pill.ours.map((person) => (
              <span key={person.login} className="-ml-[5px] rounded-full">
                <Avatar login={person.login} className="ring-[1.5px] ring-sea-soft" />
              </span>
            ))}
          </span>
        </span>
      )}
      {pill.others.length > 0 && (
        // Same overlap as inside the pill; next to a pill the first face tucks onto its edge.
        <span className={`flex ${pill.ours.length > 0 ? '' : 'pl-[5px]'}`}>
          {pill.others.map((person) => (
            <span key={person.login} className="-ml-[5px] rounded-full" title={person.login}>
              <Avatar login={person.login} className={`ring-[1.5px] ${ring}`} />
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * "2 merged without you" in plain grey, never coral: tiles holding a merge
 * without the user's review they have not seen (DESIGN "Merged without your review").
 */
function UnseenMergeChip(props: { count: number }) {
  const label = `${props.count} ${props.count === 1 ? 'PR' : 'PRs'} merged without your review, not seen yet`;
  return (
    <span title={label} className="flex h-[15px] shrink-0 items-center gap-[3px] rounded bg-chip px-[5px] text-[9.5px] font-semibold whitespace-nowrap text-ink-2">
      <span className="font-mono tabular-nums">{props.count}</span> merged without you
    </span>
  );
}

/** "not sorted yet" in small muted words: the topic has no dossier yet, so nothing tells whose it is (Other topics only). */
function NotSortedMark() {
  return (
    <span title="No dossier yet, so PostPile cannot tell whose topic it is" className="shrink-0 text-[9.5px] font-medium whitespace-nowrap text-faint">
      not sorted yet
    </span>
  );
}

/**
 * The fixed leading column of a topic row, 14px with its gap: line one holds
 * the unread dot, line two stays empty. The name and the summary start right
 * after it on every row, so they share one x.
 */
function LeadSlot(props: { children?: ReactNode }) {
  return <span className="flex w-3.5 shrink-0 items-center justify-center">{props.children}</span>;
}

/**
 * The topic's PR state (core `prState`: failed in the merge queue, all in
 * the queue, else open, draft, merged, closed). The only place the per-state
 * counts show, as the tooltip.
 */
function PrStateMark(props: { item: TopicListItem }) {
  const { prState, prStateCounts } = props.item;
  if (prState === null) {
    return null;
  }
  // A 16px box, as wide as the smallest unread bubble above it, so the icon ends on the bubble's right edge.
  return (
    <span className="flex min-w-4 shrink-0 items-center justify-end">
      <PrStateIcon state={prState} size={11} title={stateMix(prStateCounts)} />
    </span>
  );
}

/**
 * One topic: name, faces and the unread bubble, then a one-line summary with
 * the your-move ("Reply +2") and "merged without you" chips at its end, and
 * the "not sorted yet" mark when asked for.
 */
function TopicItem(props: { item: TopicListItem; active: boolean; onSelect: () => void; flipGroup: string; notSorted?: boolean }) {
  const { item } = props;
  // Active: the white lift of the selected PR row. Unread: bold ink name, the bubble and a warm row with a faint honey ring. Read: regular, quieter.
  const unread = unreadLook(item) !== null;
  let tone: RowTone = unread ? 'unread' : 'read';
  if (props.active) {
    tone = 'active';
  }
  let name = unread ? 'font-semibold text-ink' : 'font-normal text-ink-read';
  if (props.active && !unread) {
    name = 'font-[550] text-ink';
  }
  const rows: Record<RowTone, string> = {
    active: 'bg-surface shadow-active-row',
    unread: 'bg-warm-row inset-ring inset-ring-honey/14 hover:bg-surface/55',
    read: 'hover:bg-surface/55',
  };
  return (
    <button
      type="button"
      data-flip-key={`topic:${item.topic.id}`}
      data-flip-group={props.flipGroup}
      onClick={props.onSelect}
      aria-current={props.active ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-[3px] rounded-row px-2 pt-1.5 pb-[7px] text-left ${rows[tone]}`}
    >
      <span className="flex w-full min-w-0 items-center">
        <LeadSlot>
          <UnreadDot shown={item.unreadPrs > 0} />
        </LeadSlot>
        <span className="flex min-w-0 flex-1 items-center gap-[7px]">
          <span className={`truncate text-[12.5px] leading-[normal] tracking-[-0.006em] ${name}`}>{item.topic.name}</span>
          <span className="ml-auto" />
          <FaceStack people={item.people} tone={tone} />
          <UnreadBubble item={item} />
        </span>
      </span>
      {/* The chip sits under the bubble; at 1100px row one has no room left, so the summary gives way first. */}
      <span className="flex w-full min-w-0 items-center">
        <LeadSlot />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span title={topicSnippet(item)} className="min-w-0 flex-1 truncate text-[11px] leading-[1.4] text-muted">
            {topicSnippet(item)}
          </span>
          <YourMoveChip moves={item.yourMoves} />
          {item.unseenMergeTiles > 0 && <UnseenMergeChip count={item.unseenMergeTiles} />}
          {props.notSorted && <NotSortedMark />}
          <PrStateMark item={item} />
        </span>
      </span>
    </button>
  );
}

/**
 * Section title: colored dot and label. No count: a PR count read like
 * an unread count, and how many PRs a queue holds does not matter.
 */
function SectionHeader(props: { section: TopicSection }) {
  const look = sectionLook(props.section);
  return (
    // The dot sits in the row's leading slot column, so the label lands on the same x as the topic names.
    <span
      data-flip-key={`section:${props.section}`}
      className={`flex items-center pt-1.5 pr-2 pb-1 pl-3 text-[10px] leading-[normal] font-bold tracking-[0.07em] uppercase ${look.text}`}
    >
      <span className={`mr-[5px] size-[5px] rounded-[1.5px] ${look.dot}`} />
      {look.label}
    </span>
  );
}

/** The fold chevron, in the leading slot: pointing down while open. */
function FoldChevron(props: { open: boolean }) {
  return (
    <LeadSlot>
      <span className={`flex text-faint ${props.open ? '' : '-rotate-90'}`}>
        <ChevronIcon />
      </span>
    </LeadSlot>
  );
}

/** "· 4 unread · 1 urgent" after a folded header's label. */
function FoldedSummary(props: { text: string }) {
  return <span className="ml-[5px] text-[10.5px] font-medium tracking-normal text-hint normal-case">{props.text}</span>;
}

/**
 * A section title that folds its topics away. The chevron takes the topic
 * rows' leading slot, so the label starts on the topic names' x. Folded, it
 * says what is unread inside (`summary`).
 */
function GroupHeader(props: { label: string; open: boolean; onToggle: () => void; small?: boolean; flipKey: string; summary?: string }) {
  const size = props.small ? 'text-[10.5px] font-medium text-hint' : 'text-[11px] font-semibold tracking-[0.04em] text-hint';
  return (
    <button type="button" data-flip-key={props.flipKey} aria-expanded={props.open} onClick={props.onToggle} className="flex items-center px-2 py-1 text-left">
      <FoldChevron open={props.open} />
      <span className={size}>{props.label}</span>
      {!props.open && props.summary && <FoldedSummary text={props.summary} />}
    </button>
  );
}

/** A section title that folds (Other work): the chevron in the leading slot, then the dot and label as on `SectionHeader`. */
function FoldingSectionHeader(props: { section: TopicSection; open: boolean; onToggle: () => void; summary: string }) {
  const look = sectionLook(props.section);
  return (
    <button
      type="button"
      data-flip-key={`section:${props.section}`}
      aria-expanded={props.open}
      onClick={props.onToggle}
      className={`flex items-center pt-1.5 pr-2 pb-1 pl-2 text-left text-[10px] leading-[normal] font-bold tracking-[0.07em] uppercase ${look.text}`}
    >
      <FoldChevron open={props.open} />
      <span className={`mr-[5px] size-[5px] rounded-[1.5px] ${look.dot}`} />
      {look.label}
      {!props.open && props.summary && <FoldedSummary text={props.summary} />}
    </button>
  );
}

/**
 * Topics a sync retired in the last 30 days (every PR merged or closed,
 * nothing unread, 3 quiet days), folded away under the live ones. A row
 * opens the topic like any other; a new event brings it back to the list.
 */
function FinishedDrawer(props: { open: boolean; onToggle: () => void; activeTopicId: string | null; onSelect: (topicId: string) => void }) {
  const finished = useFinishedTopics().data ?? [];
  const now = useNow(60_000);
  if (finished.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-px">
      <GroupHeader small label="Archive" open={props.open} onToggle={props.onToggle} flipKey="group:finished" />
      {props.open &&
        finished.map((topic) => {
          const active = topic.id === props.activeTopicId;
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => props.onSelect(topic.id)}
              aria-current={active ? 'true' : undefined}
              title={`${topic.prCount} ${topic.prCount === 1 ? 'PR' : 'PRs'}, retired ${whenLabel(topic.retiredAt, now)}`}
              className={`flex min-w-0 items-center gap-[7px] rounded-row px-2 py-1 text-left ${active ? 'bg-surface shadow-active-row' : 'hover:bg-surface/60'}`}
            >
              <span className={`truncate text-[12px] ${active ? 'text-ink-2' : 'text-muted'}`}>{topic.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{ageLabel(topic.retiredAt, now)}</span>
            </button>
          );
        })}
    </div>
  );
}

function InboxItem(props: { count: number; active: boolean; onSelect: () => void }) {
  const badge = props.active ? 'bg-accent text-on-accent' : 'bg-chip text-ink-2';
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.active ? 'true' : undefined}
      title="Topic changes and standing rules the agent proposes"
      className={`flex items-center gap-2 rounded-row px-2 py-[7px] text-left text-[13px] ${
        props.active ? 'bg-surface font-semibold shadow-active-row' : 'text-ink-2 hover:bg-surface/60'
      }`}
    >
      <span className="text-muted">
        <InboxIcon />
      </span>
      <span className="flex-1">Inbox</span>
      {props.count > 0 && (
        <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[10.5px] font-semibold ${badge}`}>
          {props.count}
        </span>
      )}
    </button>
  );
}

interface TopicSidebarProps {
  topics: TopicListItem[];
  activeTopicId: string | null;
  /** The tile selected in the open topic: while it stays selected, the topic's row keeps its place. */
  selectedTileId: string | null;
  onSelect: (topicId: string) => void;
  inboxCount: number;
  inboxOpen: boolean;
  onOpenInbox: () => void;
  instructionsOpen: boolean;
  onOpenInstructions: () => void;
  notificationsOpen: boolean;
  onOpenNotifications: () => void;
  quietOpen: boolean;
  onOpenQuiet: () => void;
  loading: boolean;
  error: string | null;
  /** The search bar's filter; null shows every topic. */
  filter: SearchFilter | null;
  onClearFilter: () => void;
  /** Topics left after the search and the queue filter, in API order. */
  shown: TopicListItem[];
  queueFilter: QueueFilter | null;
  /** Topics the queue filter hides (after the search), for "11 topics without your PRs are hidden". */
  hiddenByQueueFilter: number;
  onQueueFilter: (filter: QueueFilter | null) => void;
  filterCounts: Record<QueueFilter, number>;
  viewer: ViewerView | undefined;
}

/** Plain lines in the list (filter, hidden topics, errors) start on the topic names' x: a row's 8px padding plus its 14px leading slot. */
const TEXT_COLUMN = 'pr-2.5 pl-[22px]';

/** Fold keys: "other_work", "area:<name>" and "more" inside it, "fyi", "finished". */
type FoldKey = string;

/** The sections listed flat, without folds: the asks, You drive and Your team owns (short lists). */
const FLAT_SECTIONS: TopicSection[] = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned', 'you_drive', 'team_owns'];

/**
 * "11 topics without your PRs are hidden · Show all", under the sections
 * while "Topics with" narrows: says what the switch did and how to undo it.
 */
function HiddenByFilter(props: { filter: QueueFilter; hidden: number; onShowAll: () => void }) {
  const whose = props.filter === 'mine' ? 'your PRs' : "your team's PRs";
  return (
    <p className={`flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-muted ${TEXT_COLUMN}`}>
      <span>
        <span className="font-semibold text-ink-2 tabular-nums">{props.hidden}</span> {props.hidden === 1 ? 'topic' : 'topics'} without {whose} {props.hidden === 1 ? 'is' : 'are'} hidden
      </span>
      <button type="button" onClick={props.onShowAll} className="text-accent hover:underline">
        Show all
      </button>
    </p>
  );
}

/** "Filtering: 2 topics, 5 tiles · Clear", above the topic list while the search bar filters. */
function FilterHint(props: { topics: number; tiles: number; onClear: () => void }) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return (
    <p className={`flex items-center gap-1.5 text-[11.5px] text-muted ${TEXT_COLUMN}`}>
      <span>
        Filtering: {plural(props.topics, 'topic')}, {plural(props.tiles, 'tile')}
      </span>
      <span className="text-faint">·</span>
      <button type="button" onClick={props.onClear} className="text-accent hover:underline">
        Clear
      </button>
    </p>
  );
}

export function TopicSidebar(props: TopicSidebarProps) {
  // The user's own fold choices this session; a fold without one follows its default.
  const [foldChoices, setFoldChoices] = useState<Map<FoldKey, boolean>>(() => new Map());
  const tools = useTools().data;
  const filter = props.filter;
  const searching = filter !== null;
  const narrowed = searching || props.queueFilter !== null;
  // The open topic keeps its row while a tile in it stays selected ("Marked when you move on"); when it moves, rows slide.
  const navRef = useRef<HTMLElement>(null);
  useFlip(navRef, { landed: false });
  const buckets = useHeldPlace(props.selectedTileId, props.activeTopicId, sidebarBuckets(props.shown), topicRowId);
  const otherWork = bucketItems(buckets, 'other_work');
  const otherTopics = otherTopicsGroups(bucketItems(buckets, 'other_topics'));
  // `forcedOpen`: while the search filters, no match hides in a fold.
  const isOpen = (key: FoldKey, openByDefault: boolean, forcedOpen: boolean) => forcedOpen || (foldChoices.get(key) ?? openByDefault);
  const toggle = (key: FoldKey, open: boolean) => setFoldChoices(new Map(foldChoices).set(key, !open));
  const topicItem = (item: TopicListItem, group: string, notSorted = false) => (
    <TopicItem
      key={item.topic.id}
      item={item}
      flipGroup={group}
      notSorted={notSorted}
      active={item.topic.id === props.activeTopicId}
      onSelect={() => props.onSelect(item.topic.id)}
    />
  );
  // Other work and its area folds open by what they hold (`startsOpen`, over the topics the queue filter left); folded, urgent unread rows stay.
  const otherWorkOpen = isOpen('other_work', startsOpen(otherWork), searching);
  const areaFold = (fold: AreaFold) => {
    const open = isOpen(fold.key, startsOpen(fold.items), searching);
    return (
      <div key={fold.key} className="flex flex-col gap-px">
        <GroupHeader small label={fold.label} open={open} onToggle={() => toggle(fold.key, open)} flipKey={`group:${fold.key}`} summary={foldedSummary(fold.items)} />
        {(open ? fold.items : rowsWhileFolded(fold.items)).map((item) => topicItem(item, fold.key))}
      </div>
    );
  };
  // FYI starts folded and opens while anything narrows the list, as before.
  const fyiOpen = isOpen('fyi', false, narrowed);
  return (
    <nav ref={navRef} aria-label="Topics" className="pane-scroll flex min-h-0 flex-col gap-3.5 overflow-auto bg-sidebar pl-2.5 pr-0 pt-3 pb-2.5 shadow-[inset_-1px_0_0_var(--hairline-strong)]">
      <QueueFilters counts={props.filterCounts} active={props.queueFilter} viewer={props.viewer} onChange={props.onQueueFilter} />
      <InboxItem count={props.inboxCount} active={props.inboxOpen} onSelect={props.onOpenInbox} />
      {filter && <FilterHint topics={props.shown.length} tiles={filter.tileCount} onClear={props.onClearFilter} />}
      {props.error && <p className={`text-xs text-status-bad ${TEXT_COLUMN}`}>Could not load topics: {props.error}</p>}
      {narrowed && props.shown.length === 0 && props.topics.length > 0 && (
        <p className={`text-xs leading-relaxed text-muted ${TEXT_COLUMN}`}>No topic has a PR that matches.</p>
      )}
      {!props.error && !props.loading && props.topics.length === 0 && (
        <p className={`text-xs leading-relaxed text-muted ${TEXT_COLUMN}`}>
          {tools && !tools.canSync ? 'No topics yet. Sync starts once gh works.' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'}
        </p>
      )}
      {FLAT_SECTIONS.map((section) => {
        const items = bucketItems(buckets, section);
        return items.length === 0 ? null : (
          <div key={section} className="flex flex-col gap-px">
            <SectionHeader section={section} />
            {items.map((item) => topicItem(item, section))}
          </div>
        );
      })}
      {otherWork.length > 0 && (
        <div className="flex flex-col gap-1">
          <FoldingSectionHeader section="other_work" open={otherWorkOpen} onToggle={() => toggle('other_work', otherWorkOpen)} summary={foldedSummary(otherWork)} />
          {otherWorkOpen ? (
            areaFolds(otherWork).map(areaFold)
          ) : (
            <div className="flex flex-col gap-px">{rowsWhileFolded(otherWork).map((item) => topicItem(item, 'other_work'))}</div>
          )}
        </div>
      )}
      {props.queueFilter && props.hiddenByQueueFilter > 0 && (
        <HiddenByFilter filter={props.queueFilter} hidden={props.hiddenByQueueFilter} onShowAll={() => props.onQueueFilter(null)} />
      )}
      {(otherTopics.unplaced.length > 0 || otherTopics.fyi.length > 0) && (
        <div className="flex flex-col gap-1">
          <SectionHeader section="other_topics" />
          {otherTopics.unplaced.length > 0 && (
            <div className="flex flex-col gap-px">{otherTopics.unplaced.map((item) => topicItem(item, 'other_topics', isNotSorted(item)))}</div>
          )}
          {otherTopics.fyi.length > 0 && (
            <div className="flex flex-col gap-px">
              <GroupHeader small label="FYI" open={fyiOpen} onToggle={() => toggle('fyi', fyiOpen)} flipKey="group:fyi" />
              {fyiOpen && otherTopics.fyi.map((item) => topicItem(item, 'fyi'))}
            </div>
          )}
        </div>
      )}
      {/* Search and the queue filters cover live topics only, so the drawer steps aside while they narrow. */}
      {!narrowed && (
        <FinishedDrawer
          open={isOpen('finished', false, false)}
          onToggle={() => toggle('finished', isOpen('finished', false, false))}
          activeTopicId={props.activeTopicId}
          onSelect={props.onSelect}
        />
      )}
      {/*
        The list fades out at the bottom instead of stopping at a hard edge. Sticky, so it stays at
        the bottom while the list scrolls; at the end of the list it slides under the footer, where
        a sidebar-colored fade on the sidebar color shows nothing.
      */}
      <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -ml-2.5 mt-auto -mb-[70px] h-14 shrink-0 bg-linear-to-b from-transparent to-sidebar" />
      <div className="relative z-[1] flex flex-col gap-0.5 border-t border-hairline-strong pt-2.5">
        <InboxCleanup place="line" />
        <button
          type="button"
          onClick={props.onOpenInstructions}
          aria-current={props.instructionsOpen ? 'true' : undefined}
          title="What the agent knows about you, in your words, with its version history"
          className={`flex items-center gap-2 rounded-control px-2 py-[7px] text-left text-[12.5px] ${
            props.instructionsOpen ? 'bg-surface font-semibold shadow-active-row' : 'text-ink-2 hover:bg-surface/60'
          }`}
        >
          <span className="text-muted">
            <InstructionsIcon />
          </span>
          Your instructions
        </button>
        <button
          type="button"
          onClick={props.onOpenNotifications}
          aria-current={props.notificationsOpen ? 'true' : undefined}
          title="Debug: the raw GitHub notification threads as stored, and where each landed. Read only, nothing is marked read."
          className={`flex items-center gap-2 rounded-control px-2 py-[7px] text-left text-[12.5px] ${
            props.notificationsOpen ? 'bg-surface font-semibold shadow-active-row' : 'text-ink-2 hover:bg-surface/60'
          }`}
        >
          <span className="text-muted">
            <BellIcon />
          </span>
          Notifications
          <span className="ml-auto font-mono text-[9.5px] font-normal text-faint">debug</span>
        </button>
        <button
          type="button"
          onClick={props.onOpenQuiet}
          aria-current={props.quietOpen ? 'true' : undefined}
          title="Threads you had read that came back only because of bots, which PostPile marked read on GitHub in the last 7 days"
          className={`flex items-center gap-2 rounded-control px-2 py-[7px] text-left text-[12.5px] ${
            props.quietOpen ? 'bg-surface font-semibold shadow-active-row' : 'text-ink-2 hover:bg-surface/60'
          }`}
        >
          <span className="text-muted">
            <CheckIcon />
          </span>
          Handled quietly
        </button>
      </div>
    </nav>
  );
}
