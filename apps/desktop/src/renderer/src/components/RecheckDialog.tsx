import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MemoryCorrection, MemoryRecheckRequest, MemoryRecheckResult } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { Button } from './Button.tsx';
import { DiffView } from './DiffView.tsx';
import { quoteLineDraft, useTellAgent } from './TellAgent.tsx';

interface RecheckDialogProps {
  request: MemoryRecheckRequest;
  onClose: () => void;
}

function Spinner() {
  return <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-hairline-strong border-t-accent" aria-hidden="true" />;
}

/** Headline and the agent's reason, for one outcome. */
function Verdict(props: { title: string; tone: string; why: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-[13px] font-semibold ${props.tone}`}>{props.title}</p>
      <p className="text-xs leading-relaxed text-ink-2 select-text">{props.why}</p>
    </div>
  );
}

/**
 * "Recheck" on a memory line: the agent checks it against GitHub, then the
 * user accepts the outcome (keep, fix, drop) or tells the agent in the tile
 * chat. Nothing changes until Accept; Accept's toast offers Undo.
 */
export function RecheckDialog(props: RecheckDialogProps) {
  const actions = useActions();
  const tellAgent = useTellAgent();
  const [result, setResult] = useState<MemoryRecheckResult | null>(null);
  const [failed, setFailed] = useState(false);
  // One agent call per dialog, also under React's dev double-mount.
  const asked = useRef(false);
  const { request, onClose } = props;

  useEffect(() => {
    if (asked.current) {
      return;
    }
    asked.current = true;
    void actions.recheckMemory(request).then((answer) => (answer ? setResult(answer) : setFailed(true)));
  }, [actions, request]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const correction: MemoryCorrection = { kind: 'wrong', factId: request.factId, topicId: request.topicId, text: request.text, fromRecheck: true };
  // A glance is not a memory line: nothing to accept into memory. The outcome
  // informs; to act on it, the user tells the agent (or the next sync rewrites it).
  const assessment = Boolean(request.prKey);
  const closeButton = (
    <Button variant="primary" onClick={onClose}>
      Close
    </Button>
  );
  const busy = actions.isBusy(`correct:${request.factId ?? request.text}`);

  async function accept(decision: MemoryCorrection) {
    if (await actions.correctMemory(decision)) {
      onClose();
    }
  }

  function tell() {
    tellAgent.tell(quoteLineDraft(request.text));
    onClose();
  }

  const tellButton = (
    <Button
      onClick={tell}
      disabled={!tellAgent.available}
      title={tellAgent.available ? 'Opens the tile chat with this line quoted' : 'Pick a tile first: the chat belongs to a tile'}
    >
      Tell the agent what's wrong
    </Button>
  );

  let body: ReactNode = (
    <p className="flex items-center gap-2 text-xs text-muted">
      <Spinner /> Agent is checking this against GitHub…
    </p>
  );
  let buttons: ReactNode = null;
  if (failed || result?.status === 'unavailable') {
    const message = result?.status === 'unavailable' ? result.message : 'The recheck did not go through.';
    body = <Verdict title="Could not recheck" tone="text-status-bad" why={message} />;
    buttons = tellButton;
  } else if (result?.outcome === 'holds') {
    body = <Verdict title="Still looks right" tone="text-safe" why={result.why} />;
    buttons = (
      <>
        {tellButton}
        {assessment ? (
          closeButton
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void accept({ ...correction, kind: 'confirm' })} title="Keep it and stop asking about it">
            Accept
          </Button>
        )}
      </>
    );
  } else if (result?.outcome === 'fix') {
    body = (
      <div className="flex flex-col gap-2">
        <Verdict title="Needs a fix" tone="text-amber-ink" why={result.why} />
        <DiffView before={request.text} after={result.text} />
      </div>
    );
    buttons = (
      <>
        {tellButton}
        {assessment ? (
          closeButton
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void accept({ ...correction, kind: 'fix', fixedText: result.text })}>
            Accept fix
          </Button>
        )}
      </>
    );
  } else if (result?.outcome === 'drop') {
    body = <Verdict title="This no longer holds" tone="text-status-bad" why={result.why} />;
    buttons = (
      <>
        {tellButton}
        {assessment ? (
          closeButton
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void accept(correction)} title="Forget this line">
            Accept
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Recheck" className="flex w-[460px] max-w-[calc(100vw-32px)] flex-col gap-3.5 rounded-tile bg-surface p-5 shadow-menu">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.04em] text-muted">{assessment ? 'RECHECK THIS ASSESSMENT' : 'RECHECK'}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="ml-auto text-faint hover:text-ink">
            ✕
          </button>
        </div>
        <blockquote className="border-l-2 border-accent-line pl-3 text-[12.5px] leading-normal text-ink select-text">{request.text}</blockquote>
        {body}
        {buttons && <div className="flex justify-end gap-2 pt-1">{buttons}</div>}
      </div>
    </div>
  );
}
