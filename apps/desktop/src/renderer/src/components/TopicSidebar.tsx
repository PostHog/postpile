import { useState, type ReactNode } from 'react';
import type { PrTier, TopicListItem, TopicPerson, ViewerView } from '@postpile/core';
import { statusLabel } from '../lib/memory.ts';
import { queueLayout, unreadLook, visibleFaces, type QueueFilter } from '../lib/queues.ts';
import { type SearchFilter } from '../lib/search.ts';
import { sidebarGroups } from '../lib/sidebar.ts';
import { Avatar } from './Avatar.tsx';
import { BellIcon, CheckIcon, ChevronIcon, InboxIcon, InstructionsIcon } from './icons.tsx';
import { QueueFilters } from './QueueFilters.tsx';

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
  mine: { label: 'My PRs', text: 'text-ink', dot: 'bg-ink' },
  team: { label: "Team's PRs", text: 'text-sea-ink', dot: 'bg-sea' },
  to_review: { label: 'To review', text: 'text-honey-ink', dot: 'bg-honey' },
  team_mentioned: { label: 'Team mentioned', text: 'text-sea-ink', dot: 'bg-sea-pale' },
  rest: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
  other: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
};

/** Coral dot while an unread tile is open; a grey count when all unread tiles are merged or closed. */
function UnreadMark(props: { item: TopicListItem }) {
  const look = unreadLook(props.item);
  const count = props.item.unreadTiles;
  if (look === 'urgent') {
    const label = `${count} unread ${count === 1 ? 'tile' : 'tiles'}`;
    return <span title={label} aria-label={label} className="size-1.5 shrink-0 rounded-full bg-unread" />;
  }
  if (look === 'calm') {
    const label = `${count} merged since you looked`;
    return (
      <span title={label} aria-label={label} className="flex shrink-0 items-center gap-[3px] font-mono text-[10px] text-faint">
        <span className="size-1.5 rounded-full bg-dot-quiet" />
        {count}
      </span>
    );
  }
  return null;
}

/** Up to four faces, you and your team first with a sea ring, then "+N". */
function FaceStack(props: { people: TopicPerson[]; active: boolean }) {
  const { shown, more } = visibleFaces(props.people);
  const background = props.active ? 'ring-surface' : 'ring-sidebar';
  return (
    <span className="flex shrink-0 items-center pl-[5px]">
      {shown.map((person) => (
        <span key={person.login} className="-ml-[5px] rounded-full" title={person.relation === 'other' ? person.login : `${person.login} (${person.relation === 'you' ? 'you' : 'team'})`}>
          <Avatar login={person.login} className={`ring-2 ${person.relation === 'other' ? background : 'ring-sea'}`} />
        </span>
      ))}
      {more > 0 && <span className="ml-[3px] font-mono text-[10px] text-muted">+{more}</span>}
    </span>
  );
}

/** "2 your move" in the warm-reach honey: live tiles where whose-turn says it's the user's move. */
function YourMoveChip(props: { count: number }) {
  const label = `${props.count} ${props.count === 1 ? 'tile waits' : 'tiles wait'} on you`;
  return (
    <span title={label} className="flex h-[15px] shrink-0 items-center gap-1 rounded bg-honey-soft px-1 text-[9.5px] font-semibold whitespace-nowrap text-honey-ink">
      <span className="font-mono">{props.count}</span> your move
    </span>
  );
}

/** One topic: name, unread mark, faces and the section's PR count, then a one-line summary with the "your move" chip at its end. */
function TopicItem(props: { item: TopicListItem; active: boolean; onSelect: () => void; count: number | null; countClass: string }) {
  const { item } = props;
  const weight = props.active || unreadLook(item) === 'urgent' ? 'font-semibold' : 'font-medium';
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.active ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-[3px] rounded-row px-2 py-1.5 text-left ${props.active ? 'bg-surface shadow-active-row' : 'hover:bg-surface/60'}`}
    >
      <span className="flex w-full min-w-0 items-center gap-[7px]">
        <span className={`truncate text-[12.5px] tracking-[-0.005em] ${weight}`}>{item.topic.name}</span>
        <UnreadMark item={item} />
        <span className="ml-auto" />
        <FaceStack people={item.people} active={props.active} />
        {props.count !== null && (
          <span className={`w-[18px] shrink-0 text-right font-mono text-[10.5px] font-semibold ${props.countClass}`}>{props.count}</span>
        )}
      </span>
      {/* The chip sits under the count; at 1100px row one has no room left, so the summary gives way first. */}
      <span className="flex w-full min-w-0 items-center gap-[7px]">
        <span title={topicSnippet(item)} className="min-w-0 flex-1 truncate text-[11px] leading-[1.4] text-muted">
          {topicSnippet(item)}
        </span>
        {item.yourMoveTiles > 0 && <YourMoveChip count={item.yourMoveTiles} />}
      </span>
    </button>
  );
}

/** Queue section title: colored dot, label, PR count on the right (none for Other topics). */
function SectionHeader(props: { tier: PrTier | 'other'; count: number | null }) {
  const look = SECTION_LOOK[props.tier];
  return (
    <span className={`flex items-center gap-1.5 px-2 pt-1 pb-[3px] text-[10.5px] font-bold tracking-[0.05em] uppercase ${look.text}`}>
      <span className={`size-[7px] rounded-[2px] ${look.dot}`} />
      {look.label}
      {props.count !== null && <span className="ml-auto font-mono font-medium text-muted">{props.count}</span>}
    </span>
  );
}

/** A section title that folds its topics away. */
function GroupHeader(props: { label: string; count: number; open: boolean; onToggle: () => void; small?: boolean; indent?: boolean }) {
  const size = props.small ? 'text-[10.5px] font-medium text-muted' : 'text-[11px] font-semibold tracking-[0.04em] text-muted';
  return (
    <button type="button" aria-expanded={props.open} onClick={props.onToggle} className={`flex items-center gap-1.5 py-1 text-left ${props.indent ? 'px-4' : 'px-2'}`}>
      <span className={`text-faint ${props.open ? '' : '-rotate-90'}`}>
        <ChevronIcon />
      </span>
      <span className={size}>{props.label}</span>
      <span className="font-mono text-[10.5px] text-faint">{props.count}</span>
    </button>
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
      className={`flex items-center gap-2 rounded-row px-2.5 py-[7px] text-left text-[13px] ${
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
  onSelect: (topicId: string) => void;
  inboxCount: number;
  inboxOpen: boolean;
  onOpenInbox: () => void;
  instructionsOpen: boolean;
  onOpenInstructions: () => void;
  notificationsOpen: boolean;
  onOpenNotifications: () => void;
  loading: boolean;
  error: string | null;
  /** The search bar's filter; null shows every topic. */
  filter: SearchFilter | null;
  onClearFilter: () => void;
  /** Topics left after the search and the queue filter, in API order. */
  shown: TopicListItem[];
  queueFilter: QueueFilter | null;
  onQueueFilter: (filter: QueueFilter | null) => void;
  filterCounts: Record<QueueFilter, number>;
  viewer: ViewerView | undefined;
}

/** Section keys for the fold state: "team", "routed", "fyi", or "area:<name>". */
type SectionKey = string;

/**
 * Inside Other topics, Routed and FYI start folded: they are other teams'
 * work. Topics that need you never hide in them, they are listed under
 * "Needs you" whatever their relation.
 */
const FOLDED_BY_DEFAULT: SectionKey[] = ['routed', 'fyi'];

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
  const filter = props.filter;
  const narrowed = filter !== null || props.queueFilter !== null;
  const layout = queueLayout(props.shown);
  const groups = sidebarGroups(layout.other);
  // While filtering every fold is open, so no match hides in one.
  const isOpen = (key: SectionKey) => narrowed || !folded.includes(key);
  const toggle = (key: SectionKey) => setFolded(isOpen(key) ? [...folded, key] : folded.filter((entry) => entry !== key));
  const topicItem = (item: TopicListItem, count: number | null, countClass = '') => (
    <TopicItem
      key={item.topic.id}
      item={item}
      active={item.topic.id === props.activeTopicId}
      onSelect={() => props.onSelect(item.topic.id)}
      count={count}
      countClass={countClass}
    />
  );
  const otherItems = (items: TopicListItem[]) => items.map((item) => topicItem(item, null));
  const group = (key: SectionKey, label: string, items: TopicListItem[], children: ReactNode) =>
    items.length === 0 ? null : (
      <div key={key} className="flex flex-col gap-px">
        <GroupHeader small label={label} count={items.length} open={isOpen(key)} onToggle={() => toggle(key)} />
        {isOpen(key) && children}
      </div>
    );
  return (
    <nav aria-label="Topics" className="@container flex min-h-0 flex-col gap-3.5 overflow-auto border-r border-hairline-strong bg-sidebar px-2.5 pt-3 pb-2.5">
      <QueueFilters counts={props.filterCounts} active={props.queueFilter} viewer={props.viewer} onChange={props.onQueueFilter} />
      <InboxItem count={props.inboxCount} active={props.inboxOpen} onSelect={props.onOpenInbox} />
      {filter && <FilterHint topics={props.shown.length} tiles={filter.tileCount} onClear={props.onClearFilter} />}
      {props.error && <p className="px-2.5 text-xs text-unread-ink">Could not load topics: {props.error}</p>}
      {narrowed && props.shown.length === 0 && props.topics.length > 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">No topic has a PR that matches.</p>
      )}
      {!props.error && !props.loading && props.topics.length === 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.</p>
      )}
      {layout.sections.map((section) => (
        <div key={section.tier} className="flex flex-col gap-px">
          <SectionHeader tier={section.tier} count={section.count} />
          {section.rows.map((row) => topicItem(row.item, row.count, SECTION_LOOK[section.tier].text))}
        </div>
      ))}
      {layout.other.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionHeader tier="other" count={null} />
          {group('needs', 'Needs you', groups.needsYou, otherItems(groups.needsYou))}
          {group(
            'team',
            'Your team',
            groups.team.flatMap((entry) => entry.items),
            groups.team.map((entry) => (
              <div key={entry.area} className="flex flex-col gap-px">
                <GroupHeader small indent label={entry.area} count={entry.items.length} open={isOpen(`area:${entry.area}`)} onToggle={() => toggle(`area:${entry.area}`)} />
                {isOpen(`area:${entry.area}`) && otherItems(entry.items)}
              </div>
            )),
          )}
          {group('routed', 'Routed to you', groups.routed, otherItems(groups.routed))}
          {group('fyi', 'FYI', groups.fyi, otherItems(groups.fyi))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-hairline-strong pt-2.5">
        <button
          type="button"
          onClick={props.onOpenInstructions}
          aria-current={props.instructionsOpen ? 'true' : undefined}
          title="What the agent knows about you, in your words, with its version history"
          className={`flex items-center gap-2 rounded-control px-2.5 py-[7px] text-left text-[12.5px] ${
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
          className={`flex items-center gap-2 rounded-control px-2.5 py-[7px] text-left text-[12.5px] ${
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
          disabled
          title="Not wired yet: the API has no list of quietly handled PRs"
          className="flex items-center gap-2 rounded-control px-2.5 py-[7px] text-[12.5px] text-ink-2 opacity-60"
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
