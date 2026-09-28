import type { ReconcileAction } from '@postpile/core';
import type { z } from 'zod';
import type { factReconcileOutput } from './schemas.ts';
import type { FactReconcileInput } from './service.ts';

type ReconcileAnswer = z.infer<typeof factReconcileOutput>;
type Decision = ReconcileAnswer['decisions'][number];

function toAction(decision: Decision, input: FactReconcileInput): ReconcileAction | null {
  const item = input.items[decision.item];
  if (!item) {
    return null;
  }
  const { candidate } = item;
  if (decision.action === 'add') {
    return { kind: 'add', candidate };
  }
  // Every other action names a stored fact, and it must be one this item showed.
  const fact = item.existing.find((f) => f.id === decision.factId?.trim());
  if (!fact) {
    return null;
  }
  if (decision.action === 'update') {
    return { kind: 'update', factId: fact.id, candidate, reason: decision.reason };
  }
  if (decision.action === 'invalidate') {
    return { kind: 'invalidate', factId: fact.id, reason: decision.reason, at: candidate.validFrom };
  }
  return { kind: 'noop', factId: fact.id, refs: candidate.refs };
}

/** At most one action per item, in item order. Items the answer skipped or got wrong are left out. */
export function mapReconcileAnswer(answer: ReconcileAnswer, input: FactReconcileInput): ReconcileAction[] {
  const byItem = new Map<number, ReconcileAction>();
  for (const decision of answer.decisions) {
    if (byItem.has(decision.item)) {
      continue;
    }
    const action = toAction(decision, input);
    if (action) {
      byItem.set(decision.item, action);
    }
  }
  return [...byItem.entries()].sort(([a], [b]) => a - b).map(([, action]) => action);
}
