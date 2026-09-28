import type { PrDetail, TileView } from '@code-manager/core';
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
  if (approvedAt) {
    return `You approved ${ageLabel(approvedAt, now)} ago`;
  }
  if (props.detail.pr.state !== 'OPEN') {
    return 'Only open PRs can be approved';
  }
  return blocked ?? 'Approves on GitHub right away. Cannot be undone.';
}

/** Approve, ask, mark read, snooze, chat. Approve acts on the PR, the rest on the tile. */
export function ActionBar(props: ActionBarProps) {
  const actions = useActions();
  const now = useNow();
  const { pr, userState } = props.detail;
  const tileId = props.view.tile.id;
  const approved = Boolean(userState?.approvedAt);
  const canApprove = pr.state === 'OPEN' && !approved && !actions.isBusy(`approve:${pr.key}`);
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-hairline bg-actionbar px-[22px] py-3">
      <Button
        variant="primary"
        size="md"
        disabled={!canApprove}
        title={approveTitle(props, actions.blockedReason('approve'), now)}
        onClick={() => void actions.approve(pr.key)}
      >
        {approved ? 'Approved ✓' : 'Approve'}
      </Button>
      {!isBotLogin(pr.author) && (
        <Button size="md" onClick={props.onAsk}>
          Ask {pr.author}
        </Button>
      )}
      <Button
        size="md"
        title={actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks the whole tile read; GitHub follows after 6s'}
        onClick={() => void actions.markRead(tileId)}
      >
        Mark read
      </Button>
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
