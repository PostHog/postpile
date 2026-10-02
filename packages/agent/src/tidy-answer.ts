import type { PrKey } from '@postpile/core';
import type { z } from 'zod';
import type { topicTidyOutput } from './schemas.ts';
import type { TidyDestination, TopicTidyInput, TopicTidyResult } from './service.ts';

type TidyAnswer = z.infer<typeof topicTidyOutput>;

/** A known topic other than the one split, not folded away; else a new name; else none. */
function destinationOf(split: TidyAnswer['splits'][number], known: Set<string>, folded: Set<string>): TidyDestination | null {
  const into = split.intoTopicId?.trim();
  if (into && into !== split.topicId && known.has(into) && !folded.has(into)) {
    return { kind: 'existing', topicId: into };
  }
  const name = split.newName?.trim();
  return name ? { kind: 'new', name, topicKind: split.newKind } : null;
}

/**
 * Keeps what the input allows. A merge needs a known target and at least one
 * other known topic, each folded away once; a target is never folded away
 * itself. A split names member PRs of a topic that stays (not folded away)
 * and where they go (another known topic, or a new name), and all splits of
 * a topic together leave at least one PR behind. Renames and kind changes
 * name a known topic that stays, once each; a kind that is already the
 * topic's is no change.
 */
export function mapTidyAnswer(answer: TidyAnswer, input: TopicTidyInput): TopicTidyResult {
  const members = new Map(input.topics.map((topic) => [topic.id, new Set(topic.prs.map((pr) => pr.key))]));
  const targets = new Set(answer.merges.map((merge) => merge.intoTopicId).filter((id) => members.has(id)));
  const folded = new Set<string>();

  const merges: TopicTidyResult['merges'] = [];
  for (const merge of answer.merges) {
    if (!members.has(merge.intoTopicId) || folded.has(merge.intoTopicId)) {
      continue;
    }
    const from = [...new Set(merge.fromTopicIds)].filter((id) => id !== merge.intoTopicId && members.has(id) && !folded.has(id) && !targets.has(id));
    if (from.length === 0) {
      continue;
    }
    from.forEach((id) => folded.add(id));
    merges.push({ fromTopicIds: from, intoTopicId: merge.intoTopicId, name: merge.name?.trim() || null, reason: merge.reason });
  }

  // Counted per topic over every split entry, so several entries cannot empty a topic together.
  // The engine checks again with stacks expanded, which this package does not see.
  const leaving = new Map<string, Set<PrKey>>();
  const splits: TopicTidyResult['splits'] = [];
  for (const split of answer.splits) {
    const own = members.get(split.topicId);
    const into = destinationOf(split, new Set(members.keys()), folded);
    if (!own || folded.has(split.topicId) || !into) {
      continue;
    }
    const already = leaving.get(split.topicId) ?? new Set<PrKey>();
    const prKeys: PrKey[] = [...new Set(split.prKeys)].filter((key) => own.has(key) && !already.has(key));
    if (prKeys.length > 0 && already.size + prKeys.length < own.size) {
      prKeys.forEach((key) => already.add(key));
      leaving.set(split.topicId, already);
      splits.push({ topicId: split.topicId, prKeys, into, reason: split.reason });
    }
  }
  const renamed = new Set<string>();
  const renames: TopicTidyResult['renames'] = [];
  for (const rename of answer.renames) {
    const name = rename.name.trim();
    const topic = input.topics.find((t) => t.id === rename.topicId);
    if (!topic || folded.has(topic.id) || renamed.has(topic.id) || !name || name === topic.name) {
      continue;
    }
    renamed.add(topic.id);
    renames.push({ topicId: topic.id, name, reason: rename.reason });
  }

  const kindsSet = new Set<string>();
  const kinds: TopicTidyResult['kinds'] = [];
  for (const change of answer.kinds) {
    const topic = input.topics.find((t) => t.id === change.topicId);
    if (!topic || folded.has(topic.id) || kindsSet.has(topic.id) || topic.kind === change.kind) {
      continue;
    }
    kindsSet.add(topic.id);
    kinds.push({ topicId: topic.id, kind: change.kind });
  }
  return { merges, splits, renames, kinds };
}
