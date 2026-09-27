import type { ReactNode } from 'react';
import type { FactRef, MemoryCorrection, StaleReason } from '@code-manager/core';
import { staleLabel } from '../lib/memory.ts';
import { MemoryButton } from './MemoryButton.tsx';
import { SourceChip } from './SourceChip.tsx';

interface MemoryLineProps {
  children: ReactNode;
  /** What "Wrong" sends. "Forget" sends the same with kind forget. */
  correction: MemoryCorrection;
  stale: StaleReason | null;
  /** The user already marked it wrong; it stays until the next sync rewrites the dossier. */
  corrected: boolean;
  refs?: FactRef[];
  canForget?: boolean;
}

/**
 * One thing the agent remembers: the text with its sources and a stale or
 * "marked wrong" badge after it, and the Wrong / Forget actions on hover.
 */
export function MemoryLine(props: MemoryLineProps) {
  const greyed = props.stale !== null || props.corrected;
  return (
    <div className="group flex items-start gap-2 text-[12.5px] leading-[1.45]">
      <span className="min-w-0 flex-1">
        <span className={`select-text ${greyed ? 'text-faint' : 'text-ink-2'} ${props.corrected ? 'line-through' : ''}`}>{props.children}</span>
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
      </span>
      {!props.corrected && (
        <span className="flex shrink-0 gap-2 pt-px opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <MemoryButton correction={props.correction} />
          {props.canForget && <MemoryButton correction={{ ...props.correction, kind: 'forget' }} />}
        </span>
      )}
    </div>
  );
}
