import type { Feedback, TopicProposal } from './types.ts';

/** An accepted topic merge: `topicId` went into `intoTopicId`. */
export type TopicMergeLink = Pick<TopicProposal, 'topicId' | 'intoTopicId'>;

/**
 * The topics no rule and no agent may put a PR in (DESIGN.md › Product
 * model, "Wrong topic" sticks): every topic the user took it out of with
 * "Wrong topic", and every topic one of those was merged into since. The
 * user said "not with that work", and a merge keeps the work together under
 * the other topic's id, so the "no" goes along, through a chain of merges
 * too.
 *
 * Only the user puts the PR back, by picking the topic. Nothing here has to
 * lift an exclusion for that: a user placement is never moved by a rule, and
 * a PR only leaves one through another "Wrong topic", which is newer.
 *
 * feedback: what the user said about the PR (any kind; only wrong_topic
 * counts). merges: the accepted topic merges.
 */
export function excludedTopicIds(feedback: Array<Pick<Feedback, 'kind' | 'topicId'>>, merges: TopicMergeLink[]): Set<string> {
  const excluded = new Set<string>();
  for (const row of feedback) {
    if (row.kind === 'wrong_topic' && row.topicId !== null) {
      excluded.add(row.topicId);
    }
  }
  // Each pass adds at least one topic or ends the loop, so a chain of merges is followed to its end.
  let grew = excluded.size > 0;
  while (grew) {
    grew = false;
    for (const merge of merges) {
      if (merge.topicId === null || merge.intoTopicId === null) {
        continue;
      }
      if (excluded.has(merge.topicId) && !excluded.has(merge.intoTopicId)) {
        excluded.add(merge.intoTopicId);
        grew = true;
      }
    }
  }
  return excluded;
}
