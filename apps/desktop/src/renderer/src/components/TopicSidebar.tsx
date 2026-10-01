import { useState, type ReactNode } from 'react';
import type { PrTier, TopicListItem, TopicPerson, ViewerView } from '@postpile/core';
import { useTools } from '../api/tools.ts';
import { useFinishedTopics } from '../api/topics.ts';
import { statusLabel } from '../lib/memory.ts';
import { layoutBuckets, layoutFromBuckets, queueLayout, queueRowId, unreadLook, type QueueFilter } from '../lib/queues.ts';
import { useHeldPlace } from '../lib/use-held-place.ts';
import { type SearchFilter } from '../lib/search.ts';
import { sidebarGroups } from '../lib/sidebar.ts';
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

/** Section title, dot and count colors. Honey = aimed at you, ink = yours, sea = your team, grey = the rest. */
const SECTION_LOOK: Record<PrTier | 'other', { label: string; text: string; dot: string }> = {
  needs_reply: { label: 'Needs reply', text: 'text-honey-ink', dot: 'bg-honey' },
  changes_requested: { label: 'Changes you requested', text: 'text-honey-ink', dot: 'bg-honey' },
  mine: { label: 'My PRs', text: 'text-ink', dot: 'bg-ink' },
  team: { label: "Team's PRs", text: 'text-sea-ink', dot: 'bg-sea' },
  to_review: { label: 'To review', text: 'text-honey-ink', dot: 'bg-honey' },
  team_mentioned: { label: 'Team mentioned', text: 'text-sea-ink', dot: 'bg-sea-pale' },
  rest: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
  other: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
};

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

const PR_STATE_WORDS = { open: 'open', draft: 'draft', merged: 'merged', closed: 'closed' } as const;

/**
 * The fixed leading column of a topic row, 14px with its gap: line one holds
 * the unread dot, line two the PR state icon, both centred. The name and the
 * summary start right after it on every row, so they share one x.
 */
function LeadSlot(props: { children?: ReactNode }) {
  return <span className="flex w-3.5 shrink-0 items-center justify-center">{props.children}</span>;
}

/**
 * The topic's PR state (core `prState`: open, else draft, else merged, else
 * closed). The only place the per-state counts show, as the tooltip.
 */
function PrStateMark(props: { item: TopicListItem }) {
  const { prState, prStateCounts } = props.item;
  if (prState === null) {
    return null;
  }
  const title = (Object.keys(PR_STATE_WORDS) as (keyof typeof PR_STATE_WORDS)[])
    .filter((state) => prStateCounts[state] > 0)
    .map((state) => `${prStateCounts[state]} ${PR_STATE_WORDS[state]}`)
    .join(' · ');
  return <PrStateIcon lifecycle={prState} size={11} title={title} />;
}

/** One topic: name, faces and the unread bubble, then a one-line summary with the your-move ("Reply +2") and "merged without you" chips at its end. */
function TopicItem(props: { item: TopicListItem; active: boolean; onSelect: () => void }) {
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
      onClick={props.onSelect}
      aria-current={props.active ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-[3px] rounded-row px-2 pt-1.5 pb-[7px] text-left ${rows[tone]}`}
    >
      <span className="flex w-full min-w-0 items-center">
        <LeadSlot>{item.unreadPrs > 0 && <UnreadDot />}</LeadSlot>
        <span className="flex min-w-0 flex-1 items-center gap-[7px]">
          <span className={`truncate text-[12.5px] leading-[normal] tracking-[-0.006em] ${name}`}>{item.topic.name}</span>
          <span className="ml-auto" />
          <FaceStack people={item.people} tone={tone} />
          <UnreadBubble item={item} />
        </span>
      </span>
      {/* The chip sits under the bubble; at 1100px row one has no room left, so the summary gives way first. */}
      <span className="flex w-full min-w-0 items-center">
        <LeadSlot>
          <PrStateMark item={item} />
        </LeadSlot>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span title={topicSnippet(item)} className="min-w-0 flex-1 truncate text-[11px] leading-[1.4] text-muted">
            {topicSnippet(item)}
          </span>
          <YourMoveChip moves={item.yourMoves} />
          {item.unseenMergeTiles > 0 && <UnseenMergeChip count={item.unseenMergeTiles} />}
        </span>
      </span>
    </button>
  );
}

/**
 * Queue section title: colored dot and label. No count: a PR count read like
 * an unread count, and how many PRs a queue holds does not matter.
 */
function SectionHeader(props: { tier: PrTier | 'other' }) {
  const look = SECTION_LOOK[props.tier];
  return (
    // The dot sits in the row's leading slot column, so the label lands on the same x as the topic names.
    <span className={`flex items-center pt-1.5 pr-2 pb-1 pl-3 text-[10px] leading-[normal] font-bold tracking-[0.07em] uppercase ${look.text}`}>
      <span className={`mr-[5px] size-[5px] rounded-[1.5px] ${look.dot}`} />
      {look.label}
    </span>
  );
}

/** A section title that folds its topics away. */
function GroupHeader(props: { label: string; open: boolean; onToggle: () => void; small?: boolean; indent?: boolean }) {
  const size = props.small ? 'text-[10.5px] font-medium text-hint' : 'text-[11px] font-semibold tracking-[0.04em] text-hint';
  return (
    <button type="button" aria-expanded={props.open} onClick={props.onToggle} className={`flex items-center gap-1.5 py-1 text-left ${props.indent ? 'px-4' : 'px-2'}`}>
      <span className={`text-faint ${props.open ? '' : '-rotate-90'}`}>
        <ChevronIcon />
      </span>
      <span className={size}>{props.label}</span>
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
      <GroupHeader small label="Finished" open={props.open} onToggle={props.onToggle} />
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

/** Section keys for the fold state: "team", "routed", "fyi", "finished", or "area:<name>". */
type SectionKey = string;

/**
 * Inside Other topics, Routed and FYI start folded: they are other teams'
 * work. Topics that need you never hide in them, they are listed under
 * "Needs you" whatever their relation. Finished starts folded too.
 */
const FOLDED_BY_DEFAULT: SectionKey[] = ['routed', 'fyi', 'finished'];

/**
 * "11 topics without your PRs are hidden · Show all", under the sections
 * while "Topics with" narrows: says what the switch did and how to undo it.
 */
function HiddenByFilter(props: { filter: QueueFilter; hidden: number; onShowAll: () => void }) {
  const whose = props.filter === 'mine' ? 'your PRs' : "your team's PRs";
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 px-2.5 text-[12px] text-muted">
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
    <p className="flex items-center gap-1.5 px-2.5 text-[11.5px] text-muted">
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
  const [folded, setFolded] = useState<SectionKey[]>(FOLDED_BY_DEFAULT);
  const tools = useTools().data;
  const filter = props.filter;
  const narrowed = filter !== null || props.queueFilter !== null;
  // The open topic keeps its row while a tile in it stays selected ("Marked when you move on").
  const layout = layoutFromBuckets(useHeldPlace(props.selectedTileId, props.activeTopicId, layoutBuckets(queueLayout(props.shown)), queueRowId));
  const groups = sidebarGroups(layout.other);
  // While filtering every fold is open, so no match hides in one.
  const isOpen = (key: SectionKey) => narrowed || !folded.includes(key);
  const toggle = (key: SectionKey) => setFolded(isOpen(key) ? [...folded, key] : folded.filter((entry) => entry !== key));
  const topicItem = (item: TopicListItem) => (
    <TopicItem key={item.topic.id} item={item} active={item.topic.id === props.activeTopicId} onSelect={() => props.onSelect(item.topic.id)} />
  );
  const otherItems = (items: TopicListItem[]) => items.map(topicItem);
  const group = (key: SectionKey, label: string, items: TopicListItem[], children: ReactNode) =>
    items.length === 0 ? null : (
      <div key={key} className="flex flex-col gap-px">
        <GroupHeader small label={label} open={isOpen(key)} onToggle={() => toggle(key)} />
        {isOpen(key) && children}
      </div>
    );
  return (
    <nav aria-label="Topics" className="pane-scroll flex min-h-0 flex-col gap-3.5 overflow-auto bg-sidebar pl-2.5 pr-0 pt-3 pb-2.5 shadow-[inset_-1px_0_0_var(--hairline-strong)]">
      <QueueFilters counts={props.filterCounts} active={props.queueFilter} viewer={props.viewer} onChange={props.onQueueFilter} />
      <InboxItem count={props.inboxCount} active={props.inboxOpen} onSelect={props.onOpenInbox} />
      {filter && <FilterHint topics={props.shown.length} tiles={filter.tileCount} onClear={props.onClearFilter} />}
      {props.error && <p className="px-2.5 text-xs text-status-bad">Could not load topics: {props.error}</p>}
      {narrowed && props.shown.length === 0 && props.topics.length > 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">No topic has a PR that matches.</p>
      )}
      {!props.error && !props.loading && props.topics.length === 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">
          {tools && !tools.canSync ? 'No topics yet. Sync starts once gh works.' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'}
        </p>
      )}
      {layout.sections.map((section) => (
        <div key={section.tier} className="flex flex-col gap-px">
          <SectionHeader tier={section.tier} />
          {section.rows.map((row) => topicItem(row.item))}
        </div>
      ))}
      {props.queueFilter && props.hiddenByQueueFilter > 0 && (
        <HiddenByFilter filter={props.queueFilter} hidden={props.hiddenByQueueFilter} onShowAll={() => props.onQueueFilter(null)} />
      )}
      {layout.other.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionHeader tier="other" />
          {group('needs', 'Needs you', groups.needsYou, otherItems(groups.needsYou))}
          {group(
            'team',
            'Your team',
            groups.team.flatMap((entry) => entry.items),
            groups.team.map((entry) => (
              <div key={entry.area} className="flex flex-col gap-px">
                <GroupHeader small indent label={entry.area} open={isOpen(`area:${entry.area}`)} onToggle={() => toggle(`area:${entry.area}`)} />
                {isOpen(`area:${entry.area}`) && otherItems(entry.items)}
              </div>
            )),
          )}
          {group('routed', 'Routed to you', groups.routed, otherItems(groups.routed))}
          {group('fyi', 'FYI', groups.fyi, otherItems(groups.fyi))}
        </div>
      )}
      {/* Search and the queue filters cover live topics only, so the drawer steps aside while they narrow. */}
      {!narrowed && (
        <FinishedDrawer open={isOpen('finished')} onToggle={() => toggle('finished')} activeTopicId={props.activeTopicId} onSelect={props.onSelect} />
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
