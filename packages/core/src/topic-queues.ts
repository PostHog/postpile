// Topic-level queue facts for the sidebar: how many PRs of each tier a topic
// holds, who is involved, and which tier a tile sorts under. Built on
// `prTier`; the engine and FakeEngine call the same functions.
import { isBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import { prOwners } from './pr-owners.ts';
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

/**
 * How the PR's owners (`prOwners`) relate to the viewer: 'you' when the
 * viewer is one of them, else 'team' when a teammate is, else 'other'.
 * The Mine and Team filters and "Your PR" read this, not the author.
 */
export function ownerRelation(pr: Pick<Pr, 'author' | 'assignees'>, viewer: Viewer | null): PersonRelation {
  const relations = prOwners(pr).map((owner) => personRelation(owner, viewer));
  if (relations.includes('you')) {
    return 'you';
  }
  return relations.includes('team') ? 'team' : 'other';
}

/** A face in the sidebar row: a PR owner of the topic (`prOwners`). */
export interface TopicPerson {
  login: string;
  relation: PersonRelation;
}

const RELATION_ORDER: PersonRelation[] = ['you', 'team', 'other'];

/**
 * The owners of the PRs (`prOwners`: the author, or the assignees of a
 * bot's PR), bots left out, each login once (2026-09-29: authors only;
 * reviewers and commenters show in the topic header and the dossier's
 * people line). Ordered you, your teammates, then everyone else;
 * inside each part by number of PRs, most first, ties in order of first
 * appearance.
 */
export function topicPeople(prs: Pr[], viewer: Viewer | null): TopicPerson[] {
  const authors: { person: TopicPerson; prs: number }[] = [];
  for (const owner of prs.flatMap((pr) => prOwners(pr))) {
    if (isBot(owner)) {
      continue;
    }
    const known = authors.find((entry) => sameLogin(entry.person.login, owner));
    if (known) {
      known.prs += 1;
    } else {
      authors.push({ person: { login: owner, relation: personRelation(owner, viewer) }, prs: 1 });
    }
  }
  // Array sort is stable, so equal counts keep the order of first appearance.
  const sorted = [...authors].sort(
    (a, b) => RELATION_ORDER.indexOf(a.person.relation) - RELATION_ORDER.indexOf(b.person.relation) || b.prs - a.prs,
  );
  return sorted.map((entry) => entry.person);
}

/** At most this many faces on a sidebar row. */
export const MAX_TOPIC_FACES = 3;

/**
 * The faces a sidebar row shows: the first three of `topicPeople`, no "+N".
 * You and your teammates come first and sit together in the team pill; the
 * other authors fill what is left.
 */
export function topicFaces(people: TopicPerson[]): TopicPerson[] {
  return people.slice(0, MAX_TOPIC_FACES);
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
  /**
   * The PR's move is a re-review (`isReReviewMove`): the author addressed
   * the viewer's change request, or asked them again while it stands.
   */
  changesAddressed: boolean;
}

/**
 * PR counts per tier, plus open PRs by author for the Mine and Team filters,
 * and how many Changes you requested PRs are the viewer's re-review. Tiers only
 * put open PRs in the queues; merged and closed ones are `rest`.
 * Pulled-in stack layers and PRs in quiet repos stay out of every count.
 */
export interface TopicQueues {
  tiers: Record<PrTier, number>;
  /** Open PRs the viewer owns (`ownerRelation`). */
  byYou: number;
  /** Open PRs someone else on the viewer's teams owns. */
  byTeam: number;
  /** changes_requested PRs whose move is a re-review (addressed, or asked again): the viewer's move again. */
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

/** The sections that ask something of you, in `PR_TIER_ORDER`'s order. */
const ASK_TIERS: readonly PrTier[] = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned'];

/**
 * The sidebar section a topic sits in, or null for Other topics (only rest
 * PRs, or none). A mixed topic follows what it asks of you (2026-10-01,
 * changed 2026-10-02): the highest ask (a reply, changes you requested, a
 * review, a team mention) wins, so a review waiting on you inside a topic
 * that also holds your PR shows under To review. Without an ask, My PRs when
 * it holds one of yours, else Team's PRs: a teammate's PR asks nothing of
 * you. The sidebar and the topic header's breadcrumb both read it
 * (`TopicListItem.section`, `TopicDetail.section`).
 */
export function topicSection(queues: Pick<TopicQueues, 'tiers'>): PrTier | null {
  const tiers = queues.tiers;
  const ask = ASK_TIERS.find((tier) => tiers[tier] > 0);
  if (ask) {
    return ask;
  }
  if (tiers.mine > 0) {
    return 'mine';
  }
  return tiers.team > 0 ? 'team' : null;
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
