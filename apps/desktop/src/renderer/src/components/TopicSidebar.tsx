import { useState, type ReactNode } from 'react';
import type { TopicListItem } from '@code-manager/core';
import { statusLabel } from '../lib/memory.ts';
import { sidebarGroups } from '../lib/sidebar.ts';
import { CheckIcon, ChevronIcon, InboxIcon, InstructionsIcon } from './icons.tsx';
import { RelationBadge } from './pills.tsx';

/** Second line under the name: the dossier's short state line, else tile counts. */
function topicLine(item: TopicListItem): string {
  if (item.statusLine) {
    return item.statusLine.note ? item.statusLine.note : statusLabel(item.statusLine.status);
  }
  return `${item.openTiles} open · ${item.totalTiles} tiles`;
}

function TopicItem(props: { item: TopicListItem; active: boolean; onSelect: () => void; showRelation?: boolean }) {
  const unread = props.item.unreadTiles > 0;
  const weight = props.active || unread ? 'font-semibold' : 'font-normal';
  const badge = props.active ? 'bg-accent text-on-accent' : 'bg-chip text-ink-2';
  const relation = props.item.placement?.relation;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.active ? 'true' : undefined}
      className={`grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-row px-2.5 py-2 text-left ${
        props.active ? 'bg-surface shadow-active-row' : 'hover:bg-surface/60'
      }`}
    >
      <span className={`size-[7px] justify-self-center rounded-full ${unread ? 'bg-unread ring-3 ring-unread/15' : ''}`} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate text-[13px] tracking-[-0.005em] ${weight}`}>{props.item.topic.name}</span>
        {props.showRelation && relation && <RelationBadge relation={relation} />}
      </span>
      <span
        className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[10.5px] font-semibold ${
          unread ? badge : ''
        }`}
      >
        {unread ? props.item.unreadTiles : ''}
      </span>
      <span />
      <span className="col-span-2 truncate text-[11.5px] text-muted">{topicLine(props.item)}</span>
    </button>
  );
}

/** A section title that folds its topics away. */
function GroupHeader(props: { label: string; count: number; open: boolean; onToggle: () => void; small?: boolean }) {
  const size = props.small ? 'text-[10.5px] font-medium text-faint' : 'text-[11px] font-semibold tracking-[0.04em] text-muted';
  return (
    <button type="button" aria-expanded={props.open} onClick={props.onToggle} className={`flex items-center gap-1.5 pb-1.5 text-left ${props.small ? 'px-3.5' : 'px-2.5'}`}>
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
  loading: boolean;
  error: string | null;
}

/** Section keys for the fold state: "team", "routed", "fyi", or "area:<name>". */
type SectionKey = string;

/**
 * Routed and FYI start folded: they are other teams' work. Unread topics
 * never hide in them, they are listed under "Needs you" whatever their
 * relation.
 */
const FOLDED_BY_DEFAULT: SectionKey[] = ['routed', 'fyi'];

export function TopicSidebar(props: TopicSidebarProps) {
  const [folded, setFolded] = useState<SectionKey[]>(FOLDED_BY_DEFAULT);
  const groups = sidebarGroups(props.topics);
  const isOpen = (key: SectionKey) => !folded.includes(key);
  const toggle = (key: SectionKey) => setFolded(isOpen(key) ? [...folded, key] : folded.filter((entry) => entry !== key));
  const topicItems = (items: TopicListItem[], showRelation = false) =>
    items.map((item) => (
      <TopicItem
        key={item.topic.id}
        item={item}
        active={item.topic.id === props.activeTopicId}
        onSelect={() => props.onSelect(item.topic.id)}
        showRelation={showRelation}
      />
    ));
  const section = (key: SectionKey, label: string, items: TopicListItem[], children: ReactNode) =>
    items.length === 0 ? null : (
      <div key={key} className="flex flex-col gap-0.5">
        <GroupHeader label={label} count={items.length} open={isOpen(key)} onToggle={() => toggle(key)} />
        {isOpen(key) && children}
      </div>
    );
  const teamItems = groups.team.flatMap((group) => group.items);
  return (
    <nav aria-label="Topics" className="flex min-h-0 flex-col gap-[18px] overflow-auto border-r border-hairline-strong bg-sidebar px-2.5 pt-3.5 pb-2.5">
      <InboxItem count={props.inboxCount} active={props.inboxOpen} onSelect={props.onOpenInbox} />
      {props.error && <p className="px-2.5 text-xs text-unread-ink">Could not load topics: {props.error}</p>}
      {!props.error && !props.loading && props.topics.length === 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.</p>
      )}
      {section('needs', 'Needs you', groups.needsYou, topicItems(groups.needsYou, true))}
      {section(
        'team',
        'Your team',
        teamItems,
        groups.team.map((group) => (
          <div key={group.area} className="flex flex-col gap-0.5">
            <GroupHeader small label={group.area} count={group.items.length} open={isOpen(`area:${group.area}`)} onToggle={() => toggle(`area:${group.area}`)} />
            {isOpen(`area:${group.area}`) && topicItems(group.items)}
          </div>
        )),
      )}
      {section('routed', 'Routed to you', groups.routed, topicItems(groups.routed))}
      {section('fyi', 'FYI', groups.fyi, topicItems(groups.fyi))}
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
