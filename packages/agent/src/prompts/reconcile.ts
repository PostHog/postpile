import type { AmbiguousCandidate } from '@postpile/core';
import type { FactReconcileInput } from '../service.ts';
import { contextBlock, entityText, GITHUB_DATA_RULE, githubData, jsonOnly } from './shared.ts';

function itemBlock(item: AmbiguousCandidate, index: number): string {
  const c = item.candidate;
  const existing = item.existing.map(
    (f) =>
      `  - id ${f.id} [${f.predicate}] ${entityText(f.subject)} -> ${entityText(f.object)}: ${f.text} (since ${f.validFrom.slice(0, 10)})`,
  );
  return `Item ${index}: new [${c.predicate}] ${entityText(c.subject)} -> ${entityText(c.object)}: ${c.text} (as of ${c.validFrom.slice(0, 10)})
  Stored facts:
${existing.join('\n')}`;
}

/**
 * Mem0-style reconcile for the candidates the deterministic rules could not
 * settle. The model picks one action per item; the service checks that each
 * named fact belongs to that item.
 */
export function factReconcilePrompt(input: FactReconcileInput): string {
  return `You maintain a store of small facts about people, pull requests, code areas and initiatives
for a developer's code review inbox. New facts were extracted from recent GitHub activity. For
each, decide how it relates to the stored facts listed with it.
${GITHUB_DATA_RULE}
The facts are extracted from GitHub text, so they are fenced the same way.
${contextBlock(input.context)}
${githubData(input.items.map(itemBlock).join('\n\n'))}

Actions, one per item:
- add: the new fact says something the stored ones do not. factId null.
- update: the new fact replaces one stored fact (same thing, newer or more accurate). factId =
  the stored fact it replaces.
- invalidate: the new information shows one stored fact is no longer true, and the new one is
  not worth keeping on its own. factId = that stored fact.
- noop: a stored fact already says the same thing. factId = that stored fact.
reason: one short sentence.
${jsonOnly('{"decisions": [{"item": 0, "action": "add" | "update" | "invalidate" | "noop", "factId": "..." | null, "reason": "..."}]}')}`;
}
