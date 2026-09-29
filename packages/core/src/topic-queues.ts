// Topic-level queue facts for the sidebar: how many PRs of each tier a topic
// holds, who is involved, and which tier a tile sorts under. Built on
// `prTier`; the engine and FakeEngine call the same functions.
import { isBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import { PR_TIER_ORDER, type PrTier } from './pr-tier.ts';
import type { Pr, PrKey, PrState, Provenance, Tile, Viewer } from './types.ts';

/** How a login relates to the viewer: the viewer, someone on their teams, anyone else. */
export type PersonRelation = 'you' | 'team' | 'other';

export function personRelation(login: string, viewer: Viewer | null): PersonRelation {
  if (viewer === null) {
    return 'other';
  }
  if (sameLogin(login, viewer.login)) {
    return 'you';
  }
  return (viewer.teamMembers ?? []).some((member) => sameLogin(member, login)) ? 'team' : 'other';
}

/** A face in the sidebar row's stack. */
export interface TopicPerson {
  login: string;
  relation: PersonRelation;
}

/**
 * Authors, reviewers (submitted, then still requested) and commenters of the
 * PRs, bots left out, each login once. The viewer and their team come first,
 * then everyone else; inside each part the order of first appearance holds.
 */
export function topicPeople(prs: Pr[], viewer: Viewer | null): TopicPerson[] {
  const people: TopicPerson[] = [];
  const add = (login: string) => {
    if (!isBot(login) && !people.some((person) => sameLogin(person.login, login))) {
      people.push({ login, relation: personRelation(login, viewer) });
    }
  };
  for (const pr of prs) {
    add(pr.author);
    pr.reviews.filter((review) => review.state !== 'PENDING').forEach((review) => add(review.author));
    pr.reviewerUsers.forEach(add);
    pr.comments.forEach((comment) => add(comment.author));
    pr.threads.forEach((thread) => thread.comments.forEach((comment) => add(comment.author)));
  }
  const ours = people.filter((person) => person.relation !== 'other');
  return [...ours, ...people.filter((person) => person.relation === 'other')];
}

/** At most this many faces on a sidebar row. */
export const MAX_TOPIC_FACES = 3;

/**
 * The faces a sidebar row shows. When the viewer or teammates are involved,
 * only they show (viewer first, then teammates); everyone else is dropped,
 * since "am I or my team in this?" is what the row answers. Only when neither
 * is involved do the other people show. At most three, no "+N".
 */
export function topicFaces(people: TopicPerson[]): TopicPerson[] {
  const you = people.filter((person) => person.relation === 'you');
  const team = people.filter((person) => person.relation === 'team');
  const ours = [...you, ...team];
  const faces = ours.length > 0 ? ours : people.filter((person) => person.relation === 'other');
  return faces.slice(0, MAX_TOPIC_FACES);
}

/** What the sidebar needs to know about one PR of a topic. */
export interface QueuedPr {
  tier: PrTier;
  author: PersonRelation;
  state: PrState;
  /** Only pulled into the topic's tiles as a stack layer, never pinged. */
  pulledIn: boolean;
  /** In a quiet repo ("Let it go stale"). */
  quiet: boolean;
  /** The author addressed the viewer's change request (`changesAnswered`). */
  changesAddressed: boolean;
}

/**
 * PR counts per tier, plus open PRs by author for the Mine and Team filters,
 * and how many Changes you requested PRs the author addressed. Tiers only
 * put open PRs in the queues; merged and closed ones are `rest`.
 * Pulled-in stack layers and PRs in quiet repos stay out of every count.
 */
export interface TopicQueues {
  tiers: Record<PrTier, number>;
  /** Open PRs the viewer wrote. */
  byYou: number;
  /** Open PRs someone else on the viewer's teams wrote. */
  byTeam: number;
  /** changes_requested PRs whose author addressed the changes: the viewer's move again. */
  changesAddressed: number;
}

export function emptyTierCounts(): Record<PrTier, number> {
  return { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 };
}

export function topicQueues(prs: QueuedPr[]): TopicQueues {
  const tiers = emptyTierCounts();
  let byYou = 0;
  let byTeam = 0;
  let changesAddressed = 0;
  for (const pr of prs) {
    if (pr.pulledIn || pr.quiet) {
      continue;
    }
    tiers[pr.tier] += 1;
    if (pr.tier === 'changes_requested' && pr.changesAddressed) {
      changesAddressed += 1;
    }
    if (pr.state !== 'OPEN') {
      continue;
    }
    if (pr.author === 'you') {
      byYou += 1;
    } else if (pr.author === 'team') {
      byTeam += 1;
    }
  }
  return { tiers, byYou, byTeam, changesAddressed };
}

/** The tile sorts under its most urgent PR's tier. A tile without PRs is `rest`. */
export function tileTier(tiers: PrTier[]): PrTier {
  return PR_TIER_ORDER.find((tier) => tiers.includes(tier)) ?? 'rest';
}

/**
 * PRs some tile of the topic holds as pinged or found. Any other PR there was
 * only pulled in as a stack layer: context on its tile, outside the queues.
 */
export function pingedPrKeys(tiles: Tile[]): Set<PrKey> {
  const keys = new Set<PrKey>();
  for (const member of tiles.flatMap((tile) => tile.members)) {
    if (member.provenance.kind !== 'pulled_in') {
      keys.add(member.prKey);
    }
  }
  return keys;
}

/**
 * The tier a tile member shows and sorts by: a pulled-in layer and a PR in a
 * quiet repo are `rest`, whatever `prTier` says.
 */
export function memberTier(tier: PrTier, provenance: Provenance, quietRepo: boolean): PrTier {
  return provenance.kind === 'pulled_in' || quietRepo ? 'rest' : tier;
}
