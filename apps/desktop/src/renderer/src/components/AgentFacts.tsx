import type { FactView } from '@postpile/core';
import { blockRefs } from '../lib/memory.ts';
import { MemoryLine } from './MemoryLine.tsx';

/**
 * "What the agent knows": facts about the PR or citing it, with sources.
 * Stale ones are greyed ("updating" while a sync or catch-up runs); only big
 * claims get Recheck.
 */
export function AgentFacts(props: { facts: FactView[]; updating: boolean }) {
  const refs = blockRefs(props.facts.map((view) => view.fact));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="pb-0.5 text-[11px] font-semibold tracking-[0.04em] text-muted">What the agent knows</span>
      {props.facts.length === 0 && <span className="text-xs text-hint">Nothing learned about this PR yet.</span>}
      {props.facts.map((view, index) => (
        <MemoryLine
          key={view.fact.id}
          correction={{ kind: 'wrong', factId: view.fact.id, topicId: view.fact.topicId, text: view.fact.text }}
          stale={view.stale}
          updating={props.updating}
          corrected={false}
          refs={refs[index]}
          canRecheck={view.recheckable}
          why={{ kind: 'fact', factId: view.fact.id }}
        >
          {view.fact.text}
        </MemoryLine>
      ))}
    </div>
  );
}
