import { useState } from 'react';
import type { TileView } from '@code-manager/core';
import { usePr } from '../api/pr.ts';
import { ActionBar } from './ActionBar.tsx';
import { AskComposer } from './AskComposer.tsx';
import { DetailContext } from './DetailContext.tsx';
import { PrBody } from './PrBody.tsx';
import { TileChat } from './TileChat.tsx';

interface DetailPaneProps {
  view: TileView | null;
  prKey: string | null;
  onSelectPr: (prKey: string) => void;
}

const paneFrame = 'flex min-h-0 flex-col border-l border-hairline-strong bg-surface';

/** Right pane: the selected tile's context header, then one of its PRs in full. */
export function DetailPane(props: DetailPaneProps) {
  const pr = usePr(props.prKey);
  const [chatOpen, setChatOpen] = useState(false);
  const [askingFor, setAskingFor] = useState<string | null>(null);

  if (!props.view || !props.prKey) {
    return (
      <aside aria-label="Details" className={`${paneFrame} items-center justify-center px-8 text-center text-xs text-muted`}>
        Pick a tile to see its PRs here.
      </aside>
    );
  }
  const view = props.view;
  const prKey = props.prKey;
  const summary = view.prs.find((candidate) => candidate.key === prKey) ?? null;

  let body = <p className="flex-1 px-[22px] py-[18px] text-xs text-muted">Loading {prKey}…</p>;
  if (chatOpen) {
    body = <TileChat view={view} onClose={() => setChatOpen(false)} />;
  } else if (pr.error) {
    body = <p className="flex-1 px-[22px] py-[18px] text-xs text-unread-ink">Could not load {prKey}: {pr.error.message}</p>;
  } else if (pr.data) {
    body = <PrBody detail={pr.data} summary={summary} view={view} />;
  }

  return (
    <aside aria-label="Details" className={`${paneFrame} shadow-accent-top`}>
      <DetailContext view={view} prKey={prKey} onSelectPr={props.onSelectPr} />
      {body}
      {pr.data && askingFor === prKey && (
        <AskComposer key={prKey} prKey={prKey} author={pr.data.pr.author} onClose={() => setAskingFor(null)} />
      )}
      {pr.data && (
        <ActionBar
          detail={pr.data}
          view={view}
          chatOpen={chatOpen}
          onAsk={() => setAskingFor(prKey)}
          onToggleChat={() => setChatOpen(!chatOpen)}
        />
      )}
    </aside>
  );
}
