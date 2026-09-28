import type { PrDetail, PrPrimaryAction, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { isBotLogin } from '../lib/people.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { ChatIcon } from './icons.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { markReadNote } from '../lib/guard.ts';

interface ActionBarProps {
  detail: PrDetail;
  view: TileView;
  chatOpen: boolean;
  onAsk: () => void;
  onToggleChat: () => void;
}

/** Why Approve is disabled or what it does, for the hover title. */
function approveTitle(props: ActionBarProps, blocked: string | null, now: Date): string {
  const approvedAt = props.detail.userState?.approvedAt;
  if (approvedAt && props.detail.userState?.approvedCommitOid === props.detail.pr.headOid) {
    return `You approved ${ageLabel(approvedAt, now)} ago`;
  }
  return blocked ?? 'Approves on GitHub right away. Cannot be undone.';
}

/** The primary action from core (`PrSummary.primaryAction`); Approve when the summary is missing. */
function primaryActionOf(props: ActionBarProps): PrPrimaryAction {
  const summary = props.view.prs.find((candidate) => candidate.key === props.detail.pr.key);
  return summary?.primaryAction ?? 'approve';
}

/**
 * Primary, ask, mark read, snooze, chat. The primary button comes from core:
 * Approve (or a disabled Approved) on someone else's open PR; on your own
 * PR, or a merged or closed one, Mark read while the tile is unread, else
 * Open on GitHub. Approve acts on the PR, the rest on the tile.
 */
export function ActionBar(props: ActionBarProps) {
  const actions = useActions();
  const now = useNow();
  const { pr } = props.detail;
  const tileId = props.view.tile.id;
  const primary = primaryActionOf(props);
  const markReadTitle = props.view.pendingWrite
    ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
    : (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks the whole tile read; GitHub follows after 6s');
  const markRead = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} size="md" title={markReadTitle} disabled={props.view.pendingWrite !== null} onClick={() => void actions.markRead(tileId)}>
      Mark read
    </Button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-hairline bg-actionbar px-[22px] py-3">
      {(primary === 'approve' || primary === 'approved') && (
        <Button
          variant="primary"
          size="md"
          disabled={primary === 'approved' || actions.isBusy(`approve:${pr.key}`)}
          title={approveTitle(props, actions.blockedReason('approve'), now)}
          onClick={() => void actions.approve(pr.key)}
        >
          {primary === 'approved' ? 'Approved ✓' : 'Approve'}
        </Button>
      )}
      {primary === 'mark_read' && markRead('primary')}
      {primary === 'open_on_github' && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title="Open the PR on github.com"
          className="flex h-[30px] shrink-0 items-center rounded-control bg-ink px-3 text-[12.5px] font-semibold whitespace-nowrap text-on-ink shadow-primary hover:bg-ink-2"
        >
          Open on GitHub
        </a>
      )}
      {!isBotLogin(pr.author) && props.view.prs.find((candidate) => candidate.key === pr.key)?.authorRelation !== 'you' && (
        <Button size="md" onClick={props.onAsk}>
          Ask {pr.author}
        </Button>
      )}
      {primary !== 'mark_read' && markRead('secondary')}
      <SnoozeMenu tileId={tileId} snoozed={props.view.state.kind === 'snoozed'} size="md" up />
      <button
        type="button"
        aria-label="Chat about this tile"
        aria-pressed={props.chatOpen}
        title="Chat about this tile"
        onClick={props.onToggleChat}
        className={`ml-auto flex size-[30px] items-center justify-center rounded-control border ${
          props.chatOpen ? 'border-accent bg-accent-soft text-accent' : 'border-control bg-surface text-ink-2 hover:bg-subtle'
        }`}
      >
        <ChatIcon />
      </button>
    </div>
  );
}
