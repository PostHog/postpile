import type { FactView } from '@postpile/core';
import { MemoryLine } from './MemoryLine.tsx';

/** "What the agent knows": facts about the PR or citing it, with sources. Stale ones are greyed; only big claims get Recheck. */
export function AgentFacts(props: { facts: FactView[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="pb-0.5 text-[11px] font-semibold tracking-[0.04em] text-muted">What the agent knows</span>
      {props.facts.length === 0 && <span className="text-xs text-faint">Nothing learned about this PR yet.</span>}
      {props.facts.map((view) => (
        <MemoryLine
          key={view.fact.id}
          correction={{ kind: 'wrong', factId: view.fact.id, topicId: view.fact.topicId, text: view.fact.text }}
          stale={view.stale}
          corrected={false}
          refs={view.fact.refs}
          canRecheck={view.recheckable}
          why={{ kind: 'fact', factId: view.fact.id }}
        >
          {view.fact.text}
        </MemoryLine>
      ))}
    </div>
  );
}
