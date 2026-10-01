import { activeSets, setGroupingTriggers, unplacedKeys, type SetChanges, type SetGroupingInput } from '@postpile/agent';
import {
  buildStacks,
  stackByPrKey,
  type PrKey,
  type PrSet,
  type PrSetChangeBy,
  type PrSetChangeKind,
  type PrSetMember,
  type Stack,
  type Topic,
} from '@postpile/core';
import { newSetId } from '../ids.ts';
import { errorText } from '../errors.ts';
import type { DigestDeps } from './deps.ts';

/** Meta key of the triggers the topic's last regroup saw (JSON list). */
export function setTriggersKey(topicId: string): string {
  return `set_grouping_seen:${topicId}`;
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

function rejectedTogether(a: PrSetMember[], b: PrSetMember[], rejected: Set<string>): boolean {
  return a.some((one) => b.some((other) => rejected.has(pairKey(one.prKey, other.prKey)) || rejected.has(pairKey(other.prKey, one.prKey))));
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
    return !rejectedTogether(unit, others, rejected);
  });
}

/** True when the input holds a trigger the last regroup did not see. */
function hasNewTrigger(seen: string[], now: string[]): boolean {
  const before = new Set(seen);
  return now.some((trigger) => !before.has(trigger));
}

/**
 * Keeps a topic's sets: lasting tiles of PRs that one judgement covers
 * (DESIGN.md "Tiles hold still"). A regroup runs only when something new
 * shows up (`setGroupingTriggers`), and the agent answers with changes
 * only: anything it leaves out stays. Every change is recorded with its
 * reason. A stack is one unit: a set holds it whole or not at all.
 */
export class SetGrouper {
  constructor(private readonly deps: DigestDeps) {}

  private record(topicId: string, setId: string, prKey: PrKey | null, kind: PrSetChangeKind, reason: string, by: PrSetChangeBy = 'agent'): void {
    this.deps.store.sets.recordChange({ setId, topicId, prKey, kind, reason, by, at: this.deps.now().toISOString() });
  }

  /**
   * A member whose PR now sits in another topic leaves the set: the user or
   * topic sorting moved it. Stack layers without a topic of their own stay.
   */
  private dropMovedMembers(topic: Topic): void {
    const { store } = this.deps;
    for (const set of store.sets.listActiveForTopic(topic.id)) {
      const moved = set.members.filter((member) => {
        const topicId = store.memberships.get(member.prKey)?.topicId;
        return topicId !== undefined && topicId !== topic.id;
      });
      if (moved.length === 0) {
        continue;
      }
      const left = new Set(moved.map((member) => member.prKey));
      store.transaction(() => {
        moved.forEach((member) => this.record(topic.id, set.id, member.prKey, 'left', 'moved to another topic', 'rules'));
        this.saveOrEnd({ ...set, members: set.members.filter((member) => !left.has(member.prKey)) }, 'rules');
      });
    }
  }

  /** The topic's open PRs and every member of its sets, with their glance's risk line. */
  input(topic: Topic): SetGroupingInput {
    const { store } = this.deps;
    const existingSets = store.sets.listForTopic(topic.id);
    const setKeys = new Set(existingSets.filter((set) => set.status === 'active').flatMap((set) => set.members.map((member) => member.prKey)));
    const keys = [...new Set([...store.memberships.listForTopic(topic.id).map((m) => m.prKey), ...setKeys])];
    const prs = [...store.prs.getMany(keys).values()].filter((pr) => pr.state === 'OPEN' || setKeys.has(pr.key));
    const risks: Record<PrKey, string> = {};
    for (const [key, glance] of store.glances.getMany(prs.map((pr) => pr.key))) {
      risks[key] = glance.risk;
    }
    return { topic, prs, existingSets, risks, context: this.deps.contexts.forTopic(topic.id) };
  }

  /**
   * The input when a regroup is due, else null: something new showed up, and
   * there is something to group (a set to keep, or two open PRs in none).
   */
  due(topic: Topic): SetGroupingInput | null {
    this.dropMovedMembers(topic);
    const input = this.input(topic);
    if (activeSets(input).length === 0 && unplacedKeys(input).length < 2) {
      return null;
    }
    const seen = JSON.parse(this.deps.store.meta.get(setTriggersKey(topic.id)) ?? '[]') as string[];
    return hasNewTrigger(seen, setGroupingTriggers(input)) ? input : null;
  }

  /**
   * Saves a changed set, or ends it when fewer than two units are left: a
   * set of one PR or one stack is just that tile.
   */
  private saveOrEnd(set: PrSet, by: PrSetChangeBy): void {
    const { store } = this.deps;
    const stackOf = stackByPrKey(buildStacks(store.prs.listAll()));
    if (unitsOf(set.members, stackOf).length < 2) {
      store.sets.delete(set.id);
      this.record(set.topicId, set.id, null, 'ended', 'fewer than two PRs left', by);
      return;
    }
    store.sets.save({ ...set, updatedAt: this.deps.now().toISOString() });
  }

  private applyMerges(topicId: string, sets: Map<string, PrSet>, changes: SetChanges, rejected: Set<string>, ended: Set<string>): void {
    for (const merge of changes.merged) {
      const from = sets.get(merge.setId);
      const into = sets.get(merge.intoSetId);
      if (!from || !into || rejectedTogether(from.members, into.members, rejected)) {
        continue;
      }
      const moving = from.members.filter((member) => !into.members.some((m) => m.prKey === member.prKey));
      into.members = [...into.members, ...moving];
      this.record(topicId, from.id, null, 'merged', `into "${into.title}": ${merge.reason}`);
      moving.forEach((member) => this.record(topicId, into.id, member.prKey, 'joined', `from "${from.title}": ${merge.reason}`));
      sets.delete(from.id);
      ended.add(from.id);
    }
  }

  private applyLeaves(topicId: string, sets: Map<string, PrSet>, changes: SetChanges, stackOf: Map<PrKey, Stack>): void {
    for (const leave of changes.left) {
      const set = sets.get(leave.setId);
      if (!set) {
        continue;
      }
      // A stack leaves a set whole, like it joined it.
      const leaving = new Set(stackOf.get(leave.prKey)?.prKeys ?? [leave.prKey]);
      set.members = set.members.filter((member) => !leaving.has(member.prKey));
      this.record(topicId, set.id, leave.prKey, 'left', leave.reason);
    }
  }

  private applyJoins(topicId: string, sets: Map<string, PrSet>, changes: SetChanges, stackOf: Map<PrKey, Stack>, rejected: Set<string>): void {
    for (const join of changes.joined) {
      const set = sets.get(join.setId);
      const unit = unitsOf([join.member], stackOf)[0];
      if (!set || !unit || rejectedTogether(unit, set.members, rejected)) {
        continue;
      }
      set.members = [...set.members, ...unit.filter((member) => !set.members.some((m) => m.prKey === member.prKey))];
      this.record(topicId, set.id, join.member.prKey, 'joined', join.member.reason);
    }
  }

  private applyCreated(topic: Topic, input: SetGroupingInput, changes: SetChanges, stackOf: Map<PrKey, Stack>, rejected: Set<string>): void {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    const dissolved = new Set(input.existingSets.filter((s) => s.status === 'dissolved').map((s) => memberSignature(s.members.map((m) => m.prKey))));
    for (const proposal of changes.created) {
      // The prompt says to respect the user's corrections; enforce it.
      const units = withoutRejected(unitsOf(proposal.members, stackOf), rejected);
      const members = units.flat();
      // Two units at least: a set of one stack and nothing else is just that stack.
      if (units.length < 2 || dissolved.has(memberSignature(members.map((m) => m.prKey)))) {
        continue;
      }
      const id = newSetId();
      store.sets.save({ id, topicId: topic.id, title: proposal.title, take: proposal.take, members, removedKeys: [], status: 'active', inputHash: '', createdAt: at, updatedAt: at });
      this.record(topic.id, id, null, 'created', proposal.take || proposal.title);
      members.forEach((member) => this.record(topic.id, id, member.prKey, 'joined', member.reason));
    }
  }

  /**
   * Applies the agent's changes and remembers what this regroup saw. Order:
   * rewrites, merges, leaves, joins, then new sets; a set left with fewer
   * than two units ends. A merge, join or new set the user's "not related"
   * rules out is skipped.
   */
  apply(topic: Topic, input: SetGroupingInput, changes: SetChanges): void {
    const { store } = this.deps;
    const stackOf = stackByPrKey(buildStacks(store.prs.listAll()));
    const rejected = rejectedPairs(input.existingSets);
    const sets = new Map(activeSets(input).map((set) => [set.id, { ...set, members: [...set.members] }]));
    const before = new Map([...sets].map(([id, set]) => [id, JSON.stringify([set.title, set.take, set.members])]));
    const ended = new Set<string>();

    store.transaction(() => {
      for (const update of changes.updated) {
        const set = sets.get(update.setId);
        if (set) {
          set.title = update.title;
          set.take = update.take;
          this.record(topic.id, set.id, null, 'updated', `now "${update.title}": ${update.take}`);
        }
      }
      this.applyMerges(topic.id, sets, changes, rejected, ended);
      this.applyLeaves(topic.id, sets, changes, stackOf);
      this.applyJoins(topic.id, sets, changes, stackOf, rejected);
      ended.forEach((id) => store.sets.delete(id));
      for (const set of sets.values()) {
        if (before.get(set.id) !== JSON.stringify([set.title, set.take, set.members])) {
          this.saveOrEnd(set, 'agent');
        }
      }
      this.applyCreated(topic, input, changes, stackOf, rejected);
      store.meta.set(setTriggersKey(topic.id), JSON.stringify(setGroupingTriggers(this.input(topic))));
    });
  }

  private async group(topic: Topic): Promise<void> {
    const input = this.due(topic);
    if (!input) {
      this.deps.budget.skipUnchanged('set_grouping');
      return;
    }
    if (!this.deps.budget.take('set_grouping')) {
      return;
    }
    try {
      const changes = await this.deps.agent.groupSets(input);
      this.apply(topic, input, changes);
    } catch (error) {
      this.deps.errors.push(`sets ${topic.id}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    await Promise.all(this.deps.store.topics.listActive().map((topic) => this.group(topic)));
  }
}
