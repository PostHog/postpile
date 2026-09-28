import { setGroupingInputHash, type SetProposal } from '@postpile/agent';
import { buildStacks, stackByPrKey, type PrKey, type PrSet, type PrSetMember, type Stack, type Topic } from '@postpile/core';
import { newSetId } from '../ids.ts';
import { errorText } from '../errors.ts';
import type { DigestDeps } from './deps.ts';

function hashKey(topicId: string): string {
  return `set_grouping_hash:${topicId}`;
}

function memberSignature(keys: string[]): string {
  return [...keys].sort().join(' ');
}

function pairKey(removed: string, kept: string): string {
  return `${removed} | ${kept}`;
}

/**
 * "Not related" as pairs: the removed PR must not share a set with the PRs it
 * was removed from. Stored as "removed | kept" so the removed one is dropped.
 */
function rejectedPairs(sets: PrSet[]): Set<string> {
  const pairs = new Set<string>();
  for (const set of sets) {
    for (const removed of set.removedKeys) {
      for (const member of set.members) {
        pairs.add(pairKey(removed, member.prKey));
      }
    }
  }
  return pairs;
}

/**
 * Lone PRs and whole stacks, in proposal order. A member that is a stack
 * layer brings its whole stack along, in stack order, so a set never tears
 * a layer out of its stack.
 */
function unitsOf(members: PrSetMember[], stackOf: Map<PrKey, Stack>): PrSetMember[][] {
  const units: PrSetMember[][] = [];
  const seen = new Set<PrKey>();
  for (const member of members) {
    if (seen.has(member.prKey)) {
      continue;
    }
    const keys = stackOf.get(member.prKey)?.prKeys ?? [member.prKey];
    keys.forEach((key) => seen.add(key));
    units.push(keys.map((key) => (key === member.prKey ? member : { prKey: key, reason: 'layer of the same stack' })));
  }
  return units;
}

/** Drops every unit (a PR, or a whole stack) the user already said is not related to another unit of the proposal. */
function withoutRejected(units: PrSetMember[][], rejected: Set<string>): PrSetMember[][] {
  return units.filter((unit, index) => {
    const others = units.filter((_, otherIndex) => otherIndex !== index).flat();
    return !unit.some((member) => others.some((other) => rejected.has(pairKey(member.prKey, other.prKey))));
  });
}

/**
 * Asks the agent to group related open PRs of a topic into sets. Runs only
 * when the topic's PRs, dissolved sets or feedback changed. A stack is one
 * unit: a set holds it whole or not at all. A set the agent keeps (same
 * title) keeps its id, so its tile id, snooze and chat survive.
 */
export class SetGrouper {
  constructor(private readonly deps: DigestDeps) {}

  private apply(topic: Topic, existing: PrSet[], proposals: SetProposal[], inputHash: string): void {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    const active = existing.filter((s) => s.status === 'active');
    const dissolved = new Set(existing.filter((s) => s.status === 'dissolved').map((s) => memberSignature(s.members.map((m) => m.prKey))));
    const rejected = rejectedPairs(existing);
    const stackOf = stackByPrKey(buildStacks(store.prs.listAll()));
    const kept = new Set<string>();

    store.transaction(() => {
      for (const proposal of proposals) {
        // The prompt says to respect the user's corrections; enforce it.
        const units = withoutRejected(unitsOf(proposal.members, stackOf), rejected);
        const members = units.flat();
        // Two units at least: a set of one stack and nothing else is just that stack.
        if (units.length < 2 || dissolved.has(memberSignature(members.map((m) => m.prKey)))) {
          continue;
        }
        const previous = active.find((s) => s.title.trim().toLowerCase() === proposal.title.trim().toLowerCase());
        const id = previous?.id ?? newSetId();
        kept.add(id);
        store.sets.save({
          id,
          topicId: topic.id,
          title: proposal.title,
          take: proposal.take,
          members,
          removedKeys: previous?.removedKeys ?? [],
          status: 'active',
          inputHash,
          createdAt: previous?.createdAt ?? at,
          updatedAt: at,
        });
      }
      for (const set of active) {
        if (kept.has(set.id)) {
          continue;
        }
        // A set the user corrected is kept as dissolved, so the correction is not lost with it.
        if (set.removedKeys.length > 0) {
          store.sets.dissolve(set.id, at);
        } else {
          store.sets.delete(set.id);
        }
      }
      store.meta.set(hashKey(topic.id), inputHash);
    });
  }

  private async group(topic: Topic): Promise<void> {
    const { store } = this.deps;
    const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
    const prs = [...store.prs.getMany(keys).values()].filter((pr) => pr.state === 'OPEN');
    if (prs.length < 2) {
      return;
    }
    const existingSets = store.sets.listForTopic(topic.id);
    const input = { topic, prs, existingSets, context: this.deps.contexts.forTopic(topic.id) };
    const inputHash = setGroupingInputHash(input);
    if (store.meta.get(hashKey(topic.id)) === inputHash || !this.deps.budget.take('set_grouping')) {
      return;
    }
    try {
      const proposals = await this.deps.agent.groupSets(input);
      this.apply(topic, existingSets, proposals, inputHash);
    } catch (error) {
      this.deps.errors.push(`sets ${topic.id}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    await Promise.all(this.deps.store.topics.listActive().map((topic) => this.group(topic)));
  }
}
