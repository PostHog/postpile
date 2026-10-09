import type { TopicProposal } from '@postpile/core';

/** One line for a topic proposal. topicName looks up names for renames, merges and moves. */
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
  if (proposal.kind === 'move') {
    const into = proposal.intoTopicId ? `"${topicName(proposal.intoTopicId)}"` : 'another topic';
    const count = proposal.prKeys.length;
    return `Move ${count} ${count === 1 ? 'PR' : 'PRs'} from ${topic} into ${into}`;
  }
  return `New topic "${proposal.name ?? ''}"`;
}

/**
 * Display names of MCP clients that file topic suggestions, keyed by the
 * name they send in the initialize handshake (clientInfo.name).
 */
const CLIENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-mcp-client': 'Codex',
  'cursor-vscode': 'Cursor',
};

/**
 * Who suggested a topic change from outside the app ("Claude Code"; an
 * unknown client is "an outside agent"), or null for the app's own
 * consolidation.
 */
export function suggestedBy(proposal: TopicProposal): string | null {
  if (proposal.source !== 'agent') {
    return null;
  }
  const client = proposal.client ?? '';
  return Object.hasOwn(CLIENT_NAMES, client) ? (CLIENT_NAMES[client] ?? 'an outside agent') : 'an outside agent';
}

/** The Inbox card's meta line: "topic · suggested by Claude Code · 2h ago", or "topic · 2h ago" for the app's own. */
export function proposalMeta(proposal: TopicProposal, age: string): string {
  const by = suggestedBy(proposal);
  return by ? `topic · suggested by ${by} · ${age}` : `topic · ${age}`;
}
