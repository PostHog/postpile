// The sidebar section a topic sits in (DESIGN.md "Ownership sections",
// 2026-10-02): an open ask pulls a topic up while it lasts; below the asks a
// topic sits by who drives it, the owner team only when nobody is known to
// drive it. The engine and FakeEngine call the same function for the
// sidebar row, the topic header's breadcrumb and telemetry.
import { isOwnTeam } from './mentions.ts';
import { personRelation, type PersonRelation, type TopicQueues } from './topic-queues.ts';
import { homeTeamsOf } from './team-roles.ts';
import { compareTopicUrgency, type RankedTopic, type TopicMove } from './topic-urgency.ts';
import type { Topic, Viewer } from './types.ts';
import type { TopicPlacement } from './views.ts';

/**
 * The section order, as a type: the renderer imports types only, so its
 * copy of the order is typed `TopicSectionOrder` and fails to compile if it
 * ever differs from this one.
 */
export type TopicSectionOrder = readonly [
  'needs_reply',
  'changes_requested',
  'to_review',
  'team_mentioned',
  'you_drive',
  'team_owns',
  'other_work',
  'other_topics',
  'archive',
];

/**
 * needs_reply, changes_requested, to_review, team_mentioned: the asks, as
 * the PR tiers of the same name. you_drive: the viewer drives it.
 * team_owns: a teammate drives it, or nobody does and a home team owns it.
 * other_work: someone outside the home teams drives it, or nobody does and
 * another team owns it. other_topics: FYI, and topics nothing places yet.
 * archive: retired.
 */
export type TopicSection = TopicSectionOrder[number];

/** Top to bottom, as the sidebar lists them. */
export const TOPIC_SECTION_ORDER: TopicSectionOrder = [
  'needs_reply',
  'changes_requested',
  'to_review',
  'team_mentioned',
  'you_drive',
  'team_owns',
  'other_work',
  'other_topics',
  'archive',
];

/** The PR tiers that ask something of the viewer, most urgent first. `mine` and `team` say whose PR it is, not what it asks. */
const ASK_TIERS = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned'] as const;

export interface SectionInput {
  /** The topic retired: it sits in the Archive. */
  retired: boolean;
  queues: Pick<TopicQueues, 'tiers' | 'byYou'>;
  /** The viewer's moves on live tiles (`TopicListItem.yourMoves`). */
  moves: number;
  /**
   * Who drives the topic, as it relates to the viewer; null when nobody is
   * known. Today `driverRelation(topic.driver, viewer)`; a driver the user
   * picks ("Your team", "Someone outside your team") passes its relation here.
   */
  driver: PersonRelation | null;
  /** The dossier's relation and owner team; null until the topic has a dossier. */
  placement: Pick<TopicPlacement, 'relation' | 'ownerTeam'> | null;
  /** The viewer's home teams (`homeTeamsOf`). */
  homeTeams: string[];
}

/** How the topic's driver relates to the viewer: teammates are members of any home team (`Viewer.teamMembers`). */
export function driverRelation(driver: string | null, viewer: Viewer | null): PersonRelation | null {
  return driver === null ? null : personRelation(driver, viewer);
}

/** The viewer's open PR or a move of theirs is in the topic. */
function holdsYours(byYou: number, moves: number): boolean {
  return byYou > 0 || moves > 0;
}

/**
 * An FYI topic stays in Other topics unless something stronger than "you
 * follow along" holds: the viewer's open PR or move, or the viewer or a
 * teammate drives it. An ask was checked before.
 */
function staysFyi(input: SectionInput): boolean {
  const drivenByUs = input.driver === 'you' || input.driver === 'team';
  return input.placement?.relation === 'fyi' && !holdsYours(input.queues.byYou, input.moves) && !drivenByUs;
}

/**
 * Nobody is known to drive the topic: the owner team decides. It is a weak
 * signal (`relationSignals` names the viewer's first home team as soon as
 * they wrote a PR here), so it only places a topic without a driver, and it
 * counts as home when it is any of the home teams.
 */
function ownerSection(ownerTeam: string | null, homeTeams: string[]): TopicSection {
  if (ownerTeam === null) {
    return 'other_topics';
  }
  return isOwnTeam(ownerTeam, homeTeams) ? 'team_owns' : 'other_work';
}

/**
 * First match wins: retired -> Archive; an open ask -> its section; FYI
 * without stronger evidence -> Other topics; the viewer drives -> You
 * drive; a teammate drives -> Your team owns; someone else drives -> Other
 * work; nobody known -> by the owner team, Other topics when that is
 * unknown too (a topic without a dossier: "not sorted yet").
 */
export function topicSection(input: SectionInput): TopicSection {
  if (input.retired) {
    return 'archive';
  }
  const ask = ASK_TIERS.find((tier) => input.queues.tiers[tier] > 0);
  if (ask) {
    return ask;
  }
  if (staysFyi(input)) {
    return 'other_topics';
  }
  if (input.driver === 'you') {
    return 'you_drive';
  }
  if (input.driver === 'team') {
    return 'team_owns';
  }
  if (input.driver === 'other') {
    return 'other_work';
  }
  return ownerSection(input.placement?.ownerTeam ?? null, input.homeTeams);
}

/** What the read models know about a topic when they place it. */
export interface TopicSectionSource {
  topic: Pick<Topic, 'status' | 'driver'>;
  queues: Pick<TopicQueues, 'tiers' | 'byYou'>;
  moves: number;
  placement: Pick<TopicPlacement, 'relation' | 'ownerTeam'> | null;
  /** Null before the first sync stored one: then nobody is a teammate and no team is home. */
  viewer: Viewer | null;
}

/** `topicSection` for a stored topic, its driver as the agent named it: the engine and FakeEngine both place topics through this. */
export function topicSectionOf(source: TopicSectionSource): TopicSection {
  return topicSection({
    retired: source.topic.status === 'retired',
    queues: source.queues,
    moves: source.moves,
    driver: driverRelation(source.topic.driver, source.viewer),
    placement: source.placement,
    homeTeams: source.viewer ? homeTeamsOf(source.viewer) : [],
  });
}

/** The fields `compareInSection` reads; `TopicListItem` has them all. */
export interface SectionRankedTopic extends RankedTopic {
  queues: Pick<TopicQueues, 'byYou'>;
  yourMoves: TopicMove[];
}

/**
 * Inside a section: topics with the viewer's open PR or move first, then
 * unread ones, then the urgency order (`compareTopicUrgency`). 0 on a tie,
 * so callers add their own tie-break.
 */
export function compareInSection(a: SectionRankedTopic, b: SectionRankedTopic): number {
  const yours = (topic: SectionRankedTopic) => (holdsYours(topic.queues.byYou, topic.yourMoves.length) ? 0 : 1);
  const unread = (topic: SectionRankedTopic) => (topic.unreadTiles > 0 ? 0 : 1);
  return yours(a) - yours(b) || unread(a) - unread(b) || compareTopicUrgency(a, b);
}
