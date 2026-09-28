// Topic-level queue facts for the sidebar: how many PRs of each tier a topic
// holds, who is involved, and which tier a tile sorts under. Built on
// `prTier`; the engine and FakeEngine call the same functions.
import { isBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import { PR_TIER_ORDER, type PrTier } from './pr-tier.ts';
import type { Pr, PrState, Viewer } from './types.ts';

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

/** What the sidebar needs to know about one PR of a topic. */
export interface QueuedPr {
  tier: PrTier;
  author: PersonRelation;
  state: PrState;
}

/**
 * PR counts per tier, plus open PRs by author for the Mine and Team filters.
 * Tiers only put open PRs in the queues; merged and closed ones are `rest`.
 */
export interface TopicQueues {
  tiers: Record<PrTier, number>;
  /** Open PRs the viewer wrote. */
  byYou: number;
  /** Open PRs someone else on the viewer's teams wrote. */
  byTeam: number;
}

export function emptyTierCounts(): Record<PrTier, number> {
  return { needs_reply: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 };
}

export function topicQueues(prs: QueuedPr[]): TopicQueues {
  const tiers = emptyTierCounts();
  let byYou = 0;
  let byTeam = 0;
  for (const pr of prs) {
    tiers[pr.tier] += 1;
    if (pr.state !== 'OPEN') {
      continue;
    }
    if (pr.author === 'you') {
      byYou += 1;
    } else if (pr.author === 'team') {
      byTeam += 1;
    }
  }
  return { tiers, byYou, byTeam };
}

/** The tile sorts under its most urgent PR's tier. A tile without PRs is `rest`. */
export function tileTier(tiers: PrTier[]): PrTier {
  return PR_TIER_ORDER.find((tier) => tiers.includes(tier)) ?? 'rest';
}
