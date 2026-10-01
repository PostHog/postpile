import type { PrKey } from '@postpile/core';
import type { z } from 'zod';
import type { topicTidyOutput } from './schemas.ts';
import type { TopicTidyInput, TopicTidyResult } from './service.ts';

type TidyAnswer = z.infer<typeof topicTidyOutput>;

/**
 * Keeps what the input allows. A merge needs a known target and at least one
 * other known topic, each folded away once; a target is never folded away
 * itself. A split names member PRs of a topic that stays (not folded away),
 * and leaves at least one PR behind.
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

  const splits: TopicTidyResult['splits'] = [];
  for (const split of answer.splits) {
    const own = members.get(split.topicId);
    if (!own || folded.has(split.topicId)) {
      continue;
    }
    const prKeys: PrKey[] = [...new Set(split.prKeys)].filter((key) => own.has(key));
    if (prKeys.length > 0 && prKeys.length < own.size) {
      splits.push({ topicId: split.topicId, prKeys, reason: split.reason });
    }
  }
  return { merges, splits };
}
