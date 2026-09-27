import type { TopicGroup, TopicListItem } from '@code-manager/core';
import { CheckIcon, InboxIcon, InstructionsIcon } from './icons.tsx';

const GROUP_LABELS: Record<TopicGroup, string> = { needs_you: 'Needs you', quiet: 'Quiet' };

/** Second line under the name: the agent summary, or tile counts when there is none. */
function topicLine(item: TopicListItem): string {
  if (item.topic.summary) {
    return item.topic.summary;
  }
  return `${item.openTiles} open · ${item.totalTiles} tiles`;
}

function TopicItem(props: { item: TopicListItem; active: boolean; onSelect: () => void }) {
  const unread = props.item.unreadTiles > 0;
  const weight = props.active || unread ? 'font-semibold' : 'font-normal';
  const badge = props.active ? 'bg-accent text-on-accent' : 'bg-chip text-ink-2';
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
      <span className={`truncate text-[13px] tracking-[-0.005em] ${weight}`}>{props.item.topic.name}</span>
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
  loading: boolean;
  error: string | null;
}

export function TopicSidebar(props: TopicSidebarProps) {
  const groups: TopicGroup[] = ['needs_you', 'quiet'];
  return (
    <nav aria-label="Topics" className="flex min-h-0 flex-col gap-[18px] overflow-auto border-r border-hairline-strong bg-sidebar px-2.5 pt-3.5 pb-2.5">
      <InboxItem count={props.inboxCount} active={props.inboxOpen} onSelect={props.onOpenInbox} />
      {props.error && <p className="px-2.5 text-xs text-unread-ink">Could not load topics: {props.error}</p>}
      {!props.error && !props.loading && props.topics.length === 0 && (
        <p className="px-2.5 text-xs leading-relaxed text-muted">No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.</p>
      )}
      {groups.map((group) => {
        const items = props.topics.filter((item) => item.group === group);
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 px-2.5 pb-1.5">
              <span className="text-[11px] font-semibold tracking-[0.04em] text-muted">{GROUP_LABELS[group]}</span>
              <span className="font-mono text-[10.5px] text-faint">{items.length}</span>
            </div>
            {items.map((item) => (
              <TopicItem
                key={item.topic.id}
                item={item}
                active={item.topic.id === props.activeTopicId}
                onSelect={() => props.onSelect(item.topic.id)}
              />
            ))}
          </div>
        );
      })}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-hairline-strong pt-2.5">
        <button
          type="button"
          disabled
          title="Not in the app yet: edit ~/.config/code-manager/instructions.md"
          className="flex items-center gap-2 rounded-control px-2.5 py-[7px] text-[12.5px] text-ink-2 opacity-60"
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
