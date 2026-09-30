import { useEffect, useRef, useState } from 'react';
import type { TileView } from '@postpile/core';
import { usePr } from '../api/pr.ts';
import { ActionBar } from './ActionBar.tsx';
import { AskComposer } from './AskComposer.tsx';
import { DetailContext } from './DetailContext.tsx';
import { PrBody } from './PrBody.tsx';
import type { ChatRequest } from './TellAgent.tsx';
import { TileChat } from './TileChat.tsx';

interface DetailPaneProps {
  view: TileView | null;
  prKey: string | null;
  onSelectPr: (prKey: string) => void;
  /** A newer request than the one seen at mount opens the chat with its draft. */
  chatRequest: ChatRequest | null;
  /** The line under "No tile selected". */
  noSelectionText: string;
}

// The left edge is an inset shadow, not a border, so the 22 / 34 / 62 keylines count from the pane's own edge.
const paneFrame = 'flex min-h-0 flex-col bg-surface shadow-[inset_1px_0_0_var(--hairline-strong)]';

/** Right pane: the selected tile's context header, then one of its PRs in full. */
export function DetailPane(props: DetailPaneProps) {
  const pr = usePr(props.prKey);
  const [chatOpen, setChatOpen] = useState(false);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  // The pane remounts per tile; a request made before that is not for this tile's chat.
  const handledSeq = useRef(props.chatRequest?.seq ?? 0);
  useEffect(() => {
    const chatRequest = props.chatRequest;
    if (chatRequest && chatRequest.seq > handledSeq.current) {
      handledSeq.current = chatRequest.seq;
      setChatDraft(chatRequest.draft);
      setChatOpen(true);
    }
  }, [props.chatRequest]);

  if (!props.view || !props.prKey) {
    return (
      <aside aria-label="Details" className={`${paneFrame} items-center justify-center gap-1 px-8 text-center text-xs text-muted`}>
        <p className="font-medium text-ink-2">No tile selected</p>
        <p>{props.noSelectionText}</p>
      </aside>
    );
  }
  const view = props.view;
  const prKey = props.prKey;
  const summary = view.prs.find((candidate) => candidate.key === prKey) ?? null;

  let body = <p className="flex-1 px-[22px] py-[18px] text-xs text-muted">Loading {prKey}…</p>;
  if (chatOpen) {
    body = <TileChat view={view} draft={chatDraft} onDraftChange={setChatDraft} onClose={() => setChatOpen(false)} />;
  } else if (pr.error) {
    body = <p className="flex-1 px-[22px] py-[18px] text-xs text-unread-ink">Could not load {prKey}: {pr.error.message}</p>;
  } else if (pr.data) {
    const detail = pr.data;
    const actions = (
      <div className="flex flex-col gap-2">
        <ActionBar detail={detail} view={view} chatOpen={chatOpen} onAsk={() => setAskingFor(prKey)} onToggleChat={() => setChatOpen(!chatOpen)} />
        {askingFor === prKey && (
          <AskComposer key={prKey} prKey={prKey} person={summary?.facts.owners[0] ?? detail.pr.author} onClose={() => setAskingFor(null)} />
        )}
      </div>
    );
    body = <PrBody detail={detail} summary={summary} view={view} actions={actions} />;
  }

  return (
    <aside aria-label="Details" className={paneFrame}>
      <DetailContext view={view} prKey={prKey} onSelectPr={props.onSelectPr} />
      {body}
    </aside>
  );
}
