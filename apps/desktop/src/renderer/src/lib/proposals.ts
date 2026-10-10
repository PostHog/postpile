import type { PrKey, TileView, Topic, TopicProposal } from '@postpile/core';
import { tailoringLines } from './tailoring.ts';
import { prNumber } from './tiles.ts';

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
    // No count: prKeys holds only the PRs the agent named, and Accept also moves their stack layers.
    const into = proposal.intoTopicId ? `"${topicName(proposal.intoTopicId)}"` : 'another topic';
    return `Move PRs from ${topic} into ${into}`;
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
 * unknown client shows its own name, "an outside agent" when it sent none),
 * or null for the app's own consolidation.
 */
export function suggestedBy(proposal: TopicProposal): string | null {
  if (proposal.source !== 'agent') {
    return null;
  }
  const client = (proposal.client ?? '').trim().slice(0, 40);
  if (Object.hasOwn(CLIENT_NAMES, client)) {
    return CLIENT_NAMES[client] ?? client;
  }
  return client === '' ? 'an outside agent' : client;
}

/** The Inbox card's meta line: "topic · suggested by Claude Code · 2h ago", or "topic · 2h ago" for the app's own. */
export function proposalMeta(proposal: TopicProposal, age: string): string {
  const by = suggestedBy(proposal);
  return by ? `topic · suggested by ${by} · ${age}` : `topic · ${age}`;
}

/** The PRs a split or move takes along: the ones it names, and the stack layers Accept brings with them. */
export interface ProposalPrs {
  /** "#1911 Shard backend tests", or the bare key when the PR is no longer on the topic's tiles. */
  named: string[];
  /** Other layers of their stacks: Accept moves whole stacks, like "Move to topic…". */
  stackLayers: number;
}

/** What a split or move moves, read from the source topic's tiles. Null for other kinds. */
export function proposalPrs(proposal: TopicProposal, tiles: TileView[]): ProposalPrs | null {
  if (proposal.kind !== 'split' && proposal.kind !== 'move') {
    return null;
  }
  const named = new Set<PrKey>(proposal.prKeys);
  const layers = new Set<PrKey>();
  const labels = proposal.prKeys.map((key) => {
    const view = tiles.find((candidate) => candidate.prs.some((pr) => pr.key === key));
    for (const stack of view?.tile.stacks ?? []) {
      if (stack.prKeys.includes(key)) {
        stack.prKeys.filter((layer) => !named.has(layer)).forEach((layer) => layers.add(layer));
      }
    }
    const pr = view?.prs.find((candidate) => candidate.key === key);
    return pr ? `#${prNumber(key)} ${pr.title}` : key;
  });
  return { named: labels, stackLayers: layers.size };
}

/** A merge carries the merged topic's tailoring into the target (each line says where it came from): its lines, for the card to say so. */
export function mergeCarriedLines(proposal: TopicProposal, topics: Topic[]): string[] {
  if (proposal.kind !== 'merge') {
    return [];
  }
  const from = topics.find((topic) => topic.id === proposal.topicId);
  return from ? tailoringLines(from.tailoring) : [];
}
