import { useState, type ReactNode } from 'react';
import type { FactRef, MemoryCorrection, MemoryTarget, StaleReason } from '@postpile/core';
import { staleLabel } from '../lib/memory.ts';
import { MemoryButton } from './MemoryButton.tsx';
import { RecheckDialog } from './RecheckDialog.tsx';
import { SourceChip } from './SourceChip.tsx';
import { WhyPanel } from './WhyPanel.tsx';

interface MemoryLineProps {
  children: ReactNode;
  /** Which line this is. "Recheck" asks about it, "Forget" sends it with kind forget. */
  correction: MemoryCorrection;
  stale: StaleReason | null;
  /** The user already marked it wrong; it stays until the next sync rewrites the dossier. */
  corrected: boolean;
  /** The user accepted a recheck's fix; shown instead until the next sync rewrites the dossier. */
  fixedTo?: string | null;
  refs?: FactRef[];
  canForget?: boolean;
  /** What "Why?" explains. Lines without one get no "Why?". */
  why?: MemoryTarget;
}

/**
 * One thing the agent remembers: the text with its sources and a stale,
 * "marked wrong" or "fixed" badge after it, and Why? / Recheck / Forget on
 * hover. Why? opens the sources panel under the line, Recheck the dialog.
 */
export function MemoryLine(props: MemoryLineProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const fixedTo = props.fixedTo ?? null;
  const settled = props.corrected || fixedTo !== null;
  const greyed = props.stale !== null || settled;
  const { factId, topicId, text } = props.correction;
  return (
    <div>
      <div className="group flex items-start gap-2 text-[12.5px] leading-[1.45]">
        <span className="min-w-0 flex-1">
          <span className={`select-text ${greyed ? 'text-faint' : 'text-ink-2'} ${settled ? 'line-through' : ''}`}>{props.children}</span>
          {fixedTo !== null && <span className="ml-1.5 text-ink-2 select-text">{fixedTo}</span>}
          {props.refs?.map((ref) => (
            <span key={`${ref.kind}:${ref.prKey}:${ref.sourceId ?? ''}`} className="ml-1.5 inline-flex align-[1px]">
              <SourceChip source={ref} />
            </span>
          ))}
          {props.stale && (
            <span className="ml-1.5 rounded bg-closer-soft px-1.5 text-[10px] font-medium whitespace-nowrap text-closer">
              stale · {staleLabel(props.stale)}
            </span>
          )}
          {props.corrected && <span className="ml-1.5 text-[10.5px] whitespace-nowrap text-faint">marked wrong, fixed on next sync</span>}
          {fixedTo !== null && <span className="ml-1.5 text-[10.5px] whitespace-nowrap text-faint">fixed, written in on next sync</span>}
        </span>
        <span className={`flex shrink-0 gap-2 pt-px group-focus-within:opacity-100 group-hover:opacity-100 ${whyOpen ? 'opacity-100' : 'opacity-0'}`}>
          {props.why && (
            <button
              type="button"
              aria-expanded={whyOpen}
              title="Why do you think this? Shows the sources."
              onClick={() => setWhyOpen(!whyOpen)}
              className="shrink-0 text-[11px] text-faint hover:text-accent hover:underline"
            >
              Why?
            </button>
          )}
          {!settled && (
            <button
              type="button"
              title="Ask the agent to check this against GitHub. You decide what happens after."
              onClick={() => setRecheckOpen(true)}
              className="shrink-0 text-[11px] text-faint hover:text-accent hover:underline"
            >
              Recheck
            </button>
          )}
          {!settled && props.canForget && <MemoryButton correction={{ ...props.correction, kind: 'forget' }} />}
        </span>
      </div>
      {whyOpen && props.why && <WhyPanel target={props.why} onClose={() => setWhyOpen(false)} />}
      {recheckOpen && <RecheckDialog request={{ factId, topicId, text, target: props.why ?? null }} onClose={() => setRecheckOpen(false)} />}
    </div>
  );
}
