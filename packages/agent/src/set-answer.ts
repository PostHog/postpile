import type { PrKey, PrSet } from '@postpile/core';
import type { z } from 'zod';
import type { setGroupingOutput } from './schemas.ts';
import type { SetChanges, SetGroupingInput } from './service.ts';

type SetAnswer = z.infer<typeof setGroupingOutput>;

export function activeSets(input: SetGroupingInput): PrSet[] {
  return input.existingSets.filter((set) => set.status === 'active');
}

/** Open PRs in no active set: the only ones a regroup may place. */
export function unplacedKeys(input: SetGroupingInput): PrKey[] {
  const placed = new Set(activeSets(input).flatMap((set) => set.members.map((member) => member.prKey)));
  return input.prs.filter((pr) => pr.state === 'OPEN' && !placed.has(pr.key)).map((pr) => pr.key);
}

/**
 * Keeps what the input allows: joins and new sets only from unplaced PRs,
 * each PR placed once (joins first, an existing tile wins over a new one),
 * leaves only of current members, merges and updates only of active sets.
 * The engine still enforces stacks and the user's corrections.
 */
export function mapSetAnswer(answer: SetAnswer, input: SetGroupingInput): SetChanges {
  const active = new Map(activeSets(input).map((set) => [set.id, set]));
  const free = new Set(unplacedKeys(input));

  const joined: SetChanges['joined'] = [];
  for (const join of answer.joins) {
    if (active.has(join.setId) && free.has(join.prKey)) {
      free.delete(join.prKey);
      joined.push({ setId: join.setId, member: { prKey: join.prKey, reason: join.reason } });
    }
  }

  const created: SetChanges['created'] = [];
  for (const set of answer.newSets) {
    const seen = new Set<PrKey>();
    const members = set.members.filter((member) => {
      const keep = free.has(member.prKey) && !seen.has(member.prKey);
      seen.add(member.prKey);
      return keep;
    });
    if (members.length >= 2) {
      members.forEach((member) => free.delete(member.prKey));
      created.push({ title: set.title, take: set.take, members });
    }
  }

  const left = answer.leaves.filter((leave) => active.get(leave.setId)?.members.some((member) => member.prKey === leave.prKey));
  const merged = answer.merges.filter((merge) => merge.setId !== merge.intoSetId && active.has(merge.setId) && active.has(merge.intoSetId));
  const updated = answer.updates.filter((update) => active.has(update.setId));
  return { created, joined, left, merged, updated };
}
