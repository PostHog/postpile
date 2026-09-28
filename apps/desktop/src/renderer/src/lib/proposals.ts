import type { TopicProposal } from '@postpile/core';

/** One line for a topic proposal. topicName looks up names for renames and merges. */
export function proposalText(proposal: TopicProposal, topicName: (topicId: string) => string): string {
  const topic = proposal.topicId ? `"${topicName(proposal.topicId)}"` : 'the topic';
  if (proposal.kind === 'rename') {
    return `Rename ${topic} to "${proposal.name ?? ''}"`;
  }
  if (proposal.kind === 'merge') {
    const into = proposal.intoTopicId ? `"${topicName(proposal.intoTopicId)}"` : 'another topic';
    return `Merge ${topic} into ${into}`;
  }
  if (proposal.kind === 'area_merge') {
    return `Fold area "${proposal.fromArea ?? ''}" into "${proposal.name ?? ''}"`;
  }
  if (proposal.kind === 'split') {
    return `Split "${proposal.name ?? ''}" out of ${topic}`;
  }
  return `New topic "${proposal.name ?? ''}"`;
}
