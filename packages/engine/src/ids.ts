import { randomBytes } from 'node:crypto';

function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 40) || 'topic';
}

function shortRandom(): string {
  return randomBytes(3).toString('hex');
}

/** Readable and stable: "move-ci-to-depot-3f2a1c". Renames keep the id. */
export function newTopicId(name: string): string {
  return `${slug(name)}-${shortRandom()}`;
}

export function newSetId(): string {
  return `s${randomBytes(5).toString('hex')}`;
}

export function newProposalId(): string {
  return `p${randomBytes(5).toString('hex')}`;
}

/** Event ids are "<prKey>:<kind>:<sourceId>" and a PR key never contains ":". */
export function prKeyOfEvent(eventId: string): string {
  return eventId.split(':')[0] ?? '';
}
