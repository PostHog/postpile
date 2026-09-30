import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentApproveOffer, AgentActionFrom, TileMarkReadBacking, TopicMarkReadOffer } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { approveTitle, leftOutReason, pillWord, topicMarkReadLabel, topicMarkReadTitle } from '../lib/agent-actions.ts';
import { markReadNote } from '../lib/guard.ts';
import { Button } from './Button.tsx';
import { VerdictPill } from './pills.tsx';

/** The ✨ pill on a button: what the agent judged (`low`, `medium`) or why it cannot back the action. */
export function AgentPill(props: { word: string; tone: 'solid' | 'soft' | 'off' }) {
  const look = {
    solid: 'bg-on-ink/20',
    soft: 'bg-ink/10',
    off: 'inset-ring inset-ring-edge-control',
  }[props.tone];
  return (
    <span className={`flex items-center gap-1 rounded-full px-1.5 text-[11px] leading-[17px] font-semibold ${look}`}>
      <span aria-hidden="true">✨</span>
      {props.word}
    </span>
  );
}

/** Mark read's pill, only for a backed tile. */
export function MarkReadPill(props: { backing: TileMarkReadBacking | null }) {
  if (props.backing?.state !== 'active') {
    return null;
  }
  return <AgentPill word={pillWord(props.backing)} tone="solid" />;
}

/** The confirm list: each covered PR with its verdict and risk line, the ones left out, Cancel and "Approve N". */
function ConfirmApprove(props: { offer: AgentApproveOffer; onCancel: () => void; onConfirm: () => void }) {
  const { offer, onCancel } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const prs = offer.coveredCount === 1 ? 'PR' : 'PRs';
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label="Confirm approve" className="flex max-h-[calc(100vh-64px)] w-[480px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-tile bg-surface p-5 shadow-menu">
        <h2 className="text-[14px] font-semibold text-ink">
          Approve {offer.coveredCount} {prs} on GitHub?
        </h2>
        <p className="text-xs leading-relaxed text-muted">An approval is final: there is no Undo.</p>
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {offer.covered.map((pr) => (
            <li key={pr.prKey} className="flex flex-col gap-1 rounded-row border border-hairline-strong px-3 py-2">
              <span className="flex items-baseline gap-2 text-[12.5px]">
                <code className="shrink-0 font-mono text-[11px] text-muted">{pr.prKey}</code>
                <span className="font-medium text-ink">{pr.title}</span>
              </span>
              <span className="flex items-center gap-2 text-[11.5px] text-muted">
                <VerdictPill verdict={pr.verdict} />
                {pr.riskLine}
              </span>
            </li>
          ))}
        </ul>
        {offer.leftOut.length > 0 && (
          <div className="flex flex-col gap-1 text-[11.5px] leading-snug text-muted">
            <span className="font-medium text-ink-2">Left out</span>
            {offer.leftOut.map((pr) => (
              <span key={pr.prKey}>
                <code className="font-mono text-[11px]">{pr.prKey}</code> {pr.title}: {leftOutReason(pr.reason)}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="safe" size="md" onClick={props.onConfirm} autoFocus>
            Approve {offer.coveredCount}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The ✨ Approve of a tile or the topic. Absent offer, no button. Greyed is
 * disabled with the reason in the pill. A click asks first; nothing is sent
 * before "Approve N". Locked GitHub writes skip the list and show why.
 */
export function AgentApproveButton(props: { offer: AgentApproveOffer | null; label: string; busyKey: string; from: AgentActionFrom }) {
  const actions = useActions();
  const [asking, setAsking] = useState(false);
  const { offer } = props;
  if (!offer) {
    return null;
  }
  const active = offer.state === 'active';
  const blocked = actions.blockedReason('approve');

  function confirm() {
    setAsking(false);
    if (offer) {
      const prs = offer.covered.map((pr) => ({ prKey: pr.prKey, headOid: pr.headOid }));
      void actions.approveAgent({ busyKey: props.busyKey, prs, from: props.from });
    }
  }

  return (
    <>
      <Button
        variant={active ? 'safe' : 'secondary'}
        size="md"
        title={blocked ?? approveTitle(offer, props.from === 'agent_tile' ? 'tile' : 'topic')}
        disabled={!active || actions.isBusy(props.busyKey)}
        onClick={() => (blocked ? confirm() : setAsking(true))}
      >
        {props.label}
        <AgentPill word={pillWord(offer)} tone={active ? 'solid' : 'off'} />
      </Button>
      {asking && <ConfirmApprove offer={offer} onCancel={() => setAsking(false)} onConfirm={confirm} />}
    </>
  );
}

/** The topic's "Mark N read": the existing Mark read look, the ✨ pill inside. */
export function TopicMarkReadButton(props: { offer: TopicMarkReadOffer | null; topicId: string }) {
  const actions = useActions();
  const { offer } = props;
  if (!offer) {
    return null;
  }
  const active = offer.state === 'active';
  const busyKey = `markTopic:${props.topicId}`;
  return (
    <Button
      variant={active ? 'primary' : 'secondary'}
      size="md"
      title={active ? (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? topicMarkReadTitle(offer)) : topicMarkReadTitle(offer)}
      disabled={!active || actions.isBusy(busyKey)}
      onClick={() => void actions.markTilesRead({ busyKey, tileIds: offer.coveredTileIds, skipped: offer.skipped })}
    >
      {topicMarkReadLabel(offer)}
      <AgentPill word={pillWord(offer)} tone={active ? 'solid' : 'off'} />
    </Button>
  );
}
