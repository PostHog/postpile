import { isLiveProposal, sameTopicChange } from './topic-proposals.ts';
import { cleanTopicName, EMPTY_TOPIC_NAME } from './topics.ts';
import type { IsoTime, PrKey, TopicProposal, TopicStatus } from './types.ts';

// propose_topic_change (DESIGN.md "propose_topic_change"): the checks and
// the preview for a topic change an outside agent suggests, as one pure
// function over a snapshot of the topics. The engine and the sample-data
// engine each build the snapshot and file the proposal; nothing here is
// ever applied without the user's Accept.

/** Pending outside proposals per topic, in total, and filed per rolling day. */
export const OUTSIDE_PROPOSALS_PER_TOPIC = 3;
export const OUTSIDE_PROPOSALS_PENDING = 10;
export const OUTSIDE_PROPOSALS_PER_DAY = 20;
/** The reason an agent gives, and a proposed topic name, at most this long. */
export const OUTSIDE_REASON_MAX = 300;
export const TOPIC_NAME_MAX = 100;

export type TopicChangeKind = 'split' | 'move' | 'rename' | 'merge';

/** What an outside agent asks for; PRs and topics already resolved to keys and ids. */
export interface TopicChangeRequest {
  topicId: string;
  kind: TopicChangeKind;
  /** split and move: the PRs to move out. */
  prKeys: PrKey[];
  /** split: the new topic's name; rename: the new name. */
  name: string | null;
  /** move: the existing topic the PRs go to; merge: the topic to merge into. */
  intoTopicId: string | null;
  reason: string;
  /** Check and preview only, file nothing. */
  dryRun: boolean;
}

export interface TopicChangeResult {
  /** refused: nothing filed, see reason. */
  status: 'filed' | 'dry_run' | 'refused';
  proposalId: string | null;
  /** What accepting would do, one line each. Carries topic names, which come from GitHub text: fence it. */
  preview: string[];
  reason: string | null;
  /** split, move and merge: every PR accepting would move, stack layers included. Empty for a rename. */
  movedPrKeys: PrKey[];
}

export interface TopicSnapshot {
  id: string;
  name: string;
  status: TopicStatus;
}

/** The topics as they are now, for one request. */
export interface TopicChangeSnapshot {
  now: IsoTime;
  topic: TopicSnapshot | null;
  intoTopic: TopicSnapshot | null;
  /** Every PR the topic shows now. */
  members: PrKey[];
  /** The topic a PR shows in now, null when none. */
  topicIdOf: (key: PrKey) => string | null;
  /** The PRs that change topic together with this one (its stack), itself included (`Board.movesWith`). */
  movesWith: (key: PrKey) => PrKey[];
  /** Every proposal filed about this topic, any status and source. */
  proposals: TopicProposal[];
  /** Pending outside proposals across all topics, expired ones included (filtered here). */
  pendingFromAgents: TopicProposal[];
  /** Outside proposals filed in the last 24 hours. */
  filedLastDay: number;
}

export type TopicChangePlan = { ok: true; preview: string[]; movedPrKeys: PrKey[] } | { ok: false; reason: string };

function refused(reason: string): TopicChangePlan {
  return { ok: false, reason };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function checkFields(change: TopicChangeRequest): string | null {
  const reason = change.reason.trim();
  if (reason === '' || reason.length > OUTSIDE_REASON_MAX) {
    return `reason is required, at most ${OUTSIDE_REASON_MAX} characters.`;
  }
  const name = change.name?.trim() ?? '';
  if ((change.kind === 'split' || change.kind === 'rename') && (name === '' || name.length > TOPIC_NAME_MAX)) {
    return `${change.kind} needs name, at most ${TOPIC_NAME_MAX} characters.`;
  }
  if ((change.kind === 'split' || change.kind === 'rename') && cleanTopicName(name) === '') {
    return `${EMPTY_TOPIC_NAME}.`;
  }
  if ((change.kind === 'split' || change.kind === 'move') && change.prKeys.length === 0) {
    return `${change.kind} needs prs: the PRs to move out of the topic.`;
  }
  if (change.kind === 'move' && !change.intoTopicId) {
    return 'move needs into_topic: the existing topic the PRs go to.';
  }
  if (change.kind === 'merge' && !change.intoTopicId) {
    return 'merge needs into_topic: the topic to merge into.';
  }
  return null;
}

/** Pending already, or rejected before: an agent must not file the same change twice. */
function checkRepeat(change: TopicChangeRequest, snapshot: TopicChangeSnapshot): string | null {
  const same = snapshot.proposals.filter((proposal) => sameTopicChange(proposal, { ...change, name: change.name === null ? null : cleanTopicName(change.name) }));
  const pending = same.find((proposal) => isLiveProposal(proposal, snapshot.now));
  if (pending) {
    return `The same change is pending already (filed ${pending.createdAt.slice(0, 10)}); the user has not decided yet.`;
  }
  const rejected = same.find((proposal) => proposal.status === 'rejected');
  if (rejected) {
    return `The user rejected this change on ${(rejected.decidedAt ?? rejected.createdAt).slice(0, 10)}; don't propose it again.`;
  }
  return null;
}

function checkCaps(topicId: string, snapshot: TopicChangeSnapshot): string | null {
  const live = snapshot.pendingFromAgents.filter((proposal) => isLiveProposal(proposal, snapshot.now));
  if (live.filter((proposal) => proposal.topicId === topicId).length >= OUTSIDE_PROPOSALS_PER_TOPIC) {
    return `This topic already has ${OUTSIDE_PROPOSALS_PER_TOPIC} outside suggestions waiting for the user; wait for their decision.`;
  }
  if (live.length >= OUTSIDE_PROPOSALS_PENDING) {
    return `${OUTSIDE_PROPOSALS_PENDING} outside suggestions already wait for the user; wait for their decisions.`;
  }
  if (snapshot.filedLastDay >= OUTSIDE_PROPOSALS_PER_DAY) {
    return `Agents already filed ${OUTSIDE_PROPOSALS_PER_DAY} suggestions in the last 24 hours; try again tomorrow.`;
  }
  return null;
}

/** The PRs a split or move takes out of its topic: the asked ones with their stacks, and the ones that stay. */
interface MovedPrs {
  moved: PrKey[];
  /** "X brings Y along (same stack)." lines for the preview. */
  along: string[];
  staying: PrKey[];
}

/** Refuses PRs from other topics; otherwise collects every PR that moves, whole stacks included. */
function movedPrs(change: TopicChangeRequest, snapshot: TopicChangeSnapshot, topic: TopicSnapshot): MovedPrs | string {
  const outside = change.prKeys.filter((key) => snapshot.topicIdOf(key) !== topic.id);
  if (outside.length > 0) {
    return `${list(outside)} ${outside.length === 1 ? 'is' : 'are'} not in "${topic.name}"; a ${change.kind} only moves PRs out of their own topic.`;
  }
  const moved: PrKey[] = [];
  const along: string[] = [];
  for (const key of change.prKeys) {
    const layers = snapshot.movesWith(key);
    const extra = layers.filter((layer) => layer !== key && !change.prKeys.includes(layer) && !moved.includes(layer));
    if (extra.length > 0) {
      along.push(`${key} brings ${list(extra)} along (same stack).`);
    }
    for (const layer of layers) {
      if (!moved.includes(layer)) {
        moved.push(layer);
      }
    }
  }
  const staying = snapshot.members.filter((key) => !moved.includes(key));
  return { moved, along, staying };
}

function stayLine(staying: PrKey[], topic: TopicSnapshot): string {
  return `${plural(staying.length, 'PR')} ${staying.length === 1 ? 'stays' : 'stay'} in "${topic.name}".`;
}

function splitPlan(change: TopicChangeRequest, snapshot: TopicChangeSnapshot, topic: TopicSnapshot): TopicChangePlan {
  const prs = movedPrs(change, snapshot, topic);
  if (typeof prs === 'string') {
    return refused(prs);
  }
  if (prs.staying.length === 0) {
    return refused(`That would move every PR out of "${topic.name}"; propose a rename or a merge instead.`);
  }
  const name = cleanTopicName(change.name ?? '');
  return {
    ok: true,
    movedPrKeys: prs.moved,
    preview: [
      `Split ${plural(prs.moved.length, 'PR')} out of "${topic.name}" into a new topic "${name}": ${prs.moved.join(', ')}.`,
      ...prs.along,
      stayLine(prs.staying, topic),
    ],
  };
}

function movePlan(change: TopicChangeRequest, snapshot: TopicChangeSnapshot, topic: TopicSnapshot): TopicChangePlan {
  const into = snapshot.intoTopic;
  if (!into || into.status !== 'active' || into.id === topic.id) {
    return refused(`into_topic must be another active topic; ${change.intoTopicId} is not.`);
  }
  const prs = movedPrs(change, snapshot, topic);
  if (typeof prs === 'string') {
    return refused(prs);
  }
  if (prs.staying.length === 0) {
    return refused(`That would move every PR out of "${topic.name}"; propose a merge instead.`);
  }
  return {
    ok: true,
    movedPrKeys: prs.moved,
    preview: [
      `Move ${plural(prs.moved.length, 'PR')} from "${topic.name}" into "${into.name}": ${prs.moved.join(', ')}.`,
      ...prs.along,
      stayLine(prs.staying, topic),
    ],
  };
}

/**
 * The checks of an outside topic change, in order: the fields, the topic
 * (active, the PRs in it, at least one PR stays; a move's target another
 * active topic), repeats (pending already,
 * rejected before), then the caps. On success, the preview of what
 * accepting would do, stacks included.
 */
export function planTopicChange(change: TopicChangeRequest, snapshot: TopicChangeSnapshot): TopicChangePlan {
  const fields = checkFields(change);
  if (fields) {
    return refused(fields);
  }
  const topic = snapshot.topic;
  if (!topic || topic.status !== 'active') {
    return refused(`PostPile has no active topic ${change.topicId}.`);
  }
  let plan: TopicChangePlan;
  if (change.kind === 'rename') {
    const name = cleanTopicName(change.name ?? '');
    if (name.toLowerCase() === cleanTopicName(topic.name).toLowerCase()) {
      return refused(`The topic is already called "${topic.name}".`);
    }
    plan = { ok: true, movedPrKeys: [], preview: [`Rename "${topic.name}" to "${name}".`] };
  } else if (change.kind === 'merge') {
    const into = snapshot.intoTopic;
    if (!into || into.status !== 'active' || into.id === topic.id) {
      return refused(`into_topic must be another active topic; ${change.intoTopicId} is not.`);
    }
    plan = { ok: true, movedPrKeys: snapshot.members, preview: [`Merge "${topic.name}" (${plural(snapshot.members.length, 'PR')}) into "${into.name}"; "${topic.name}" is archived.`] };
  } else if (change.kind === 'move') {
    plan = movePlan(change, snapshot, topic);
  } else {
    plan = splitPlan(change, snapshot, topic);
  }
  if (!plan.ok) {
    return plan;
  }
  const repeat = checkRepeat(change, snapshot) ?? checkCaps(topic.id, snapshot);
  return repeat ? refused(repeat) : plan;
}
