import { useActions, type NoticeTone } from '../api/actions.tsx';
import { LockIcon } from './icons.tsx';

const TONES: Record<NoticeTone, string> = {
  ok: 'bg-ink text-on-accent',
  error: 'border border-risk-line bg-status-bad-soft text-status-bad',
  blocked: 'border border-amber-line bg-amber-soft text-amber-ink',
};

/**
 * The latest action result above the footer, with Undo while a mark-read can
 * still be taken back, "Snooze until next push" after a mark-read that
 * left the tile your move, "Show" after an inbox cleanup ran (the
 * notifications view lists what each thread's last action was), and "Open"
 * when the agent answered on a topic that is not on screen.
 */
/** One Undo for every batch the toast stands for, one after another. */
async function undoAll(undo: (token: string) => Promise<void>, tokens: string[]): Promise<void> {
  for (const token of tokens) {
    await undo(token);
  }
}

export function Toast(props: { onShowActionLog: () => void; onOpenAgent?: (topicId: string) => void }) {
  const actions = useActions();
  const notice = actions.notice;
  if (!notice) {
    return null;
  }
  const undoToken = notice.undoToken;
  const moreUndoTokens = notice.moreUndoTokens ?? [];
  const snoozeTileId = notice.snoozeTileId;
  const agentTopicId = notice.openAgentTopicId ?? null;
  const openAgent = props.onOpenAgent;
  return (
    <div
      role="status"
      key={notice.id}
      className={`fixed bottom-10 left-1/2 z-30 flex max-w-[560px] -translate-x-1/2 items-center gap-3 rounded-row px-3.5 py-2 text-xs shadow-menu ${TONES[notice.tone]}`}
    >
      {notice.tone === 'blocked' && <LockIcon />}
      <span className="select-text" title={notice.detail ?? undefined}>
        {notice.message}
      </span>
      {notice.retry && (
        <button
          type="button"
          className="font-semibold whitespace-nowrap underline-offset-2 hover:underline"
          onClick={() => {
            notice.retry?.();
            actions.dismissNotice();
          }}
        >
          Try again
        </button>
      )}
      {undoToken && (
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void undoAll(actions.undo, [undoToken, ...moreUndoTokens])}>
          Undo
        </button>
      )}
      {snoozeTileId && (
        <button
          type="button"
          title="Snooze this tile until the author pushes again. Local only, nothing goes to GitHub."
          className="font-semibold whitespace-nowrap underline-offset-2 hover:underline"
          onClick={() => void actions.snooze(snoozeTileId, { kind: 'new_push' }, false)}
        >
          Snooze until next push
        </button>
      )}
      {notice.showActionLog && (
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => {
            props.onShowActionLog();
            actions.dismissNotice();
          }}
        >
          Show
        </button>
      )}
      {agentTopicId && openAgent && (
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => {
            openAgent(agentTopicId);
            actions.dismissNotice();
          }}
        >
          Open
        </button>
      )}
      <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={actions.dismissNotice}>
        ✕
      </button>
    </div>
  );
}
