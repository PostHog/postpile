import type { FactView } from '@postpile/core';
import { blockRefs } from '../lib/memory.ts';
import { MemoryLine } from './MemoryLine.tsx';
import { SectionLabel } from './SectionLabel.tsx';

/**
 * "What the agent knows": facts about the PR or citing it, with sources.
 * Stale ones are greyed ("updating" while a sync or catch-up runs); only big
 * claims get Recheck.
 */
export function AgentFacts(props: { facts: FactView[]; updating: boolean }) {
  const refs = blockRefs(props.facts.map((view) => view.fact));
  return (
    <div className="flex flex-col gap-[5px] px-3">
      <span className="pb-px">
        <SectionLabel>What the agent knows</SectionLabel>
      </span>
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
          textClass="text-[12.5px] leading-normal"
        >
          <span className={view.stale ? '' : 'text-ink'}>{view.fact.text}</span>
        </MemoryLine>
      ))}
    </div>
  );
}
