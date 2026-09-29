import type { IsoTime, Topic, TopicProposal } from './types.ts';

/** A stored topic name is at most this many characters (code points). */
export const STORED_TOPIC_NAME_MAX = 80;

// Control characters (newlines and tabs included) and the Unicode line and
// paragraph separators, which prompts would read as line breaks too.
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/gu;

/**
 * The form a topic name is stored in. Names are written by the agent from
 * PR text and several prompts show them outside the data fence, so a name
 * never spans lines: newlines and other control characters become spaces,
 * runs of whitespace collapse to one, and the name is capped at
 * STORED_TOPIC_NAME_MAX characters, cut at the last word boundary before the
 * cap (a single overlong word is cut at the cap).
 */
export function cleanTopicName(name: string): string {
  const flat = name.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= STORED_TOPIC_NAME_MAX) {
    return flat;
  }
  const cut = chars.slice(0, STORED_TOPIC_NAME_MAX).join('');
  if (chars[STORED_TOPIC_NAME_MAX] === ' ') {
    return cut;
  }
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/** Why a name is refused when nothing is left of it after `cleanTopicName` (only control characters or spaces). */
export const EMPTY_TOPIC_NAME = 'The name is empty after cleaning';

/**
 * A proposal that names a topic (new topic, rename, split) whose name is
 * empty after cleaning. Accepting it would create a blank topic or rename
 * to nothing, so it is never filed and never accepted.
 */
export function hasEmptyTopicName(proposal: Pick<TopicProposal, 'kind' | 'name'>): boolean {
  const named = proposal.kind === 'new_topic' || proposal.kind === 'rename' || proposal.kind === 'split';
  return named && cleanTopicName(proposal.name ?? '') === '';
}

/** A fresh active topic with no summary, tailoring or driver yet. The name is stored clean (`cleanTopicName`). */
export function newTopic(id: string, name: string, at: IsoTime): Topic {
  return {
    id,
    name: cleanTopicName(name),
    summary: '',
    summaryInputHash: null,
    tailoring: '',
    driver: null,
    userRole: 'watcher',
    status: 'active',
    area: null,
    createdAt: at,
    updatedAt: at,
  };
}
