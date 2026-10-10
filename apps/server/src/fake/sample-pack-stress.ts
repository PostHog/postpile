// POSTPILE_FAKE_EXTRA=stress: text and counts at their limits, for layout
// checks (BOARD-30, MEM-13): a 220-character PR title with emoji, backticks,
// angle brackets and a long unbroken token, a topic name over 64
// characters, a PR above #9999 in a repo with a long name, an agent PR with
// five assignees, a topic with 25 tiles and 30 PRs by eight authors, and a
// dossier at every bound of DOSSIER_LIMITS. PR numbers 2401 and up (and
// 12345); names and text are invented.
import { DOSSIER_LIMITS, prKey, type Dossier, type FullPr, type Glance, type PrEvent, type PrSet, type Tile, type TileMember } from '@postpile/core';
import type { SamplePack, SamplePackMemory } from './sample-pack-common.ts';
import {
  pinged,
  SAMPLE_AGENT,
  SAMPLE_VIEWER,
  SampleClock,
  sampleEvents,
  sampleGlance,
  sampleKey,
  samplePr,
  sampleTile,
  sampleTopic,
  type SampleEventInput,
} from './sample-builders.ts';

export const STRESS_TOPIC = {
  longName: 'topic-stress-long-name',
  crowded: 'topic-stress-crowded',
};

/** Over 64 characters, so the sidebar row and the header have to cut it. */
export const STRESS_TOPIC_NAME = 'Move every remaining Jenkins pipeline to GitHub Actions on Depot runners with Turbo caching';

/** 96 characters with no space: a cache key that cannot wrap at a word. */
const UNBROKEN_TOKEN = `depot-cache-key-${'0123456789abcdef'.repeat(5)}`;

/** 220 characters: emoji, backticks, angle brackets and the unbroken token. */
export const STRESS_LONG_TITLE = `🚀 Run \`turbo run test --filter=<changed>\` on Depot with ${UNBROKEN_TOKEN} so <Suspense> tests stop flaking 🔥 on arm64 and x86 in every CI job`;

/** A PR above #9999 in a repo with a long name. */
export const STRESS_BIG_NUMBER = 12345;
const LONG_REPO = 'acme/data-platform-ingestion-pipeline-workers-and-schedulers';

/** Eight authors in the crowded topic: teammates and people from other teams. */
const AUTHORS = ['rowan', 'lyra', 'nell', 'sol', 'pia', 'gus', 'omar', 'tove'];

const SUITES = ['api', 'billing', 'ingestion', 'replay', 'exports', 'alerts', 'search', 'plugins', 'auth', 'notebooks'];

/** The crowded topic's PRs: 2410 to 2439. The first ten pair up into five sets, the other twenty are single tiles. */
const CROWDED_FIRST = 2410;
const CROWDED_COUNT = 30;
const CROWDED_SET_PRS = 10;

const FILLER =
  'Each shard reads its timing data from the last green run on master, so a slow suite moves to a runner of its own and the rest stay balanced.';

/** Text of exactly `length` characters: the start, then filler, cut with a full stop. */
function textOf(start: string, length: number): string {
  let text = start;
  while (text.length < length) {
    text = `${text} ${FILLER}`;
  }
  return `${text.slice(0, length - 1)}.`;
}

/** Moves a sample PR, its events and its glance to another repo (sample-builders keys everything by `sampleRepo`). */
function inRepo(repo: string, pr: FullPr, events: PrEvent[], glance: Glance) {
  const oldKey = pr.key;
  const key = prKey({ repo, number: pr.ref.number });
  const oldUrl = pr.url;
  const url = `https://github.com/${repo}/pull/${pr.ref.number}`;
  return {
    pr: { ...pr, key, ref: { repo, number: pr.ref.number }, url, reviews: pr.reviews.map((review) => ({ ...review, url: `${url}#${review.id}` })) },
    events: events.map((event) => ({ ...event, prKey: key, id: event.id.replace(oldKey, key), url: event.url?.replace(oldUrl, url) ?? null })),
    glance: { ...glance, prKey: key },
  };
}

function buildTopics(clock: SampleClock) {
  return [
    sampleTopic(clock, {
      id: STRESS_TOPIC.longName, area: 'CI', name: STRESS_TOPIC_NAME,
      summary: textOf('rowan moves the last Jenkins pipelines over, one repo at a time.', 200),
      tailoring: '', driver: 'rowan', userRole: 'reviewer',
    }),
    sampleTopic(clock, {
      id: STRESS_TOPIC.crowded, area: 'CI', name: 'Monorepo test sharding',
      summary: textOf('Every suite in the monorepo moves to timing-based shards.', DOSSIER_LIMITS.summary),
      tailoring: '', driver: 'lyra', userRole: 'reviewer',
    }),
  ];
}

/** The long-name topic: the long title, an agent PR with five assignees and the big number in the long repo. */
function longNameTopic(clock: SampleClock) {
  const longTitle = samplePr(clock, {
    number: 2401, title: STRESS_LONG_TITLE, author: 'rowan', state: 'OPEN',
    size: [480, 120, 31], openedHoursAgo: 7, reviewerUsers: [SAMPLE_VIEWER],
    body: `Cache key: \`${UNBROKEN_TOKEN}\``,
  });
  const assigned = samplePr(clock, {
    number: 2402, title: 'Port the nightly Jenkins jobs to scheduled workflows', author: SAMPLE_AGENT,
    assignees: ['rowan', 'lyra', 'nell', 'sol', 'pia'], state: 'OPEN',
    size: [210, 180, 12], openedHoursAgo: 5, reviewerTeams: ['acme/team-platform'],
    body: 'Opened by the coding agent for @rowan, @lyra, @nell, @sol and @pia.',
  });
  const moved = inRepo(
    LONG_REPO,
    samplePr(clock, {
      number: STRESS_BIG_NUMBER, title: 'Drop the Jenkinsfile from the ingestion workers', author: 'ines', state: 'OPEN',
      size: [0, 140, 3], openedHoursAgo: 9, reviewerTeams: ['acme/team-platform'],
    }),
    sampleEvents(clock, STRESS_BIG_NUMBER, [{ kind: 'review_requested', actor: 'ines', text: 'requested a review from acme/team-platform', hoursAgo: 9, rule: 'loud' }]),
    sampleGlance(clock, STRESS_BIG_NUMBER, {
      verdict: 'LOOKS_SAFE', forYou: 'Your team is asked; it removes a Jenkinsfile.', does: 'Deletes the Jenkinsfile the ingestion workers no longer use.',
      risk: 'Low.', othersSaid: 'No comments yet.',
    }),
  );
  const prs = [longTitle, assigned, moved.pr];
  const events = [
    ...sampleEvents(clock, 2401, [
      { kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 7, rule: 'loud' },
      { kind: 'comment', actor: 'rowan', text: `commented: "the key is ${UNBROKEN_TOKEN}"`, hoursAgo: 1, rule: 'quiet' },
    ]),
    ...sampleEvents(clock, 2402, [{ kind: 'review_requested', actor: 'rowan', text: 'requested a review from acme/team-platform', hoursAgo: 5, rule: 'loud' }]),
    ...moved.events,
  ];
  const glances = [
    sampleGlance(clock, 2401, {
      verdict: 'LOOK_CLOSER', forYou: textOf(`Changes the Turbo cache key to ${UNBROKEN_TOKEN}.`, 160), does: textOf('Runs the test task on Depot.', 160),
      risk: 'Medium.', othersSaid: 'No reviews yet.',
    }),
    sampleGlance(clock, 2402, {
      verdict: 'LOOKS_SAFE', forYou: 'Your team is asked to review an agent PR five people own.', does: 'Moves the nightly jobs to scheduled workflows.',
      risk: 'Low.', othersSaid: 'No comments yet.',
    }),
    moved.glance,
  ];
  const tiles: Tile[] = [
    sampleTile(STRESS_TOPIC.longName, 'single', `pr:${sampleKey(2401)}`, STRESS_LONG_TITLE, [pinged(2401, 'review_requested')]),
    sampleTile(STRESS_TOPIC.longName, 'single', `pr:${sampleKey(2402)}`, 'Nightly Jenkins jobs move to scheduled workflows', [pinged(2402, 'review_requested')]),
    sampleTile(STRESS_TOPIC.longName, 'single', `pr:${moved.pr.key}`, 'Ingestion workers drop their Jenkinsfile', [
      { prKey: moved.pr.key, provenance: { kind: 'pinged', reason: 'review_requested' } },
    ]),
  ];
  return { prs, events, glances, tiles };
}

/** One PR of the crowded topic: authors take turns, every fourth is merged, every fifth has unread news, every third asks the team. */
function crowdedPr(clock: SampleClock, index: number) {
  const number = CROWDED_FIRST + index;
  const author = AUTHORS[index % AUTHORS.length]!;
  const suite = SUITES[index % SUITES.length]!;
  const merged = index % 4 === 3;
  const asksTeam = index % 3 === 0;
  const pr = samplePr(clock, {
    number, title: `Shard the ${suite} tests by timing, part ${Math.floor(index / SUITES.length) + 1}`, author,
    state: merged ? 'MERGED' : 'OPEN', size: [20 + index, 5, 2], openedHoursAgo: 40 + index, mergedHoursAgo: merged ? 10 + index : undefined,
    reviewerTeams: asksTeam && !merged ? ['acme/team-platform'] : [],
  });
  const inputs: SampleEventInput[] = [
    { kind: 'comment', actor: author, text: `commented: "the ${suite} suite splits into ${index % 6 + 2} shards"`, hoursAgo: 30 + index, rule: 'quiet', seen: true },
  ];
  if (asksTeam && !merged) {
    inputs.push({ kind: 'review_requested', actor: author, text: 'requested a review from acme/team-platform', hoursAgo: 20 + index, rule: 'loud', seen: true });
  }
  if (merged) {
    inputs.push({ kind: 'merged', actor: author, text: 'merged', hoursAgo: 10 + index, rule: 'quiet', seen: true });
  }
  if (index % 5 === 0 && !merged) {
    inputs.push({ kind: 'comment', actor: AUTHORS[(index + 1) % AUTHORS.length]!, text: 'commented: "shard 3 is still the slowest"', hoursAgo: 1 + index / 10, rule: 'quiet' });
  }
  const glance = sampleGlance(clock, number, {
    verdict: index % 7 === 0 ? 'LOOK_CLOSER' : 'LOOKS_SAFE', forYou: `Moves the ${suite} suite to timing-based shards.`, does: `Splits the ${suite} tests by their timing data.`,
    risk: 'Low.', othersSaid: 'No reviews yet.',
  });
  return { pr, events: sampleEvents(clock, number, inputs), glance };
}

function crowdedSet(clock: SampleClock, first: number): PrSet {
  return {
    id: `stress-set-${first}`,
    topicId: STRESS_TOPIC.crowded,
    title: `Two PRs shard the same suite (#${first}, #${first + 1})`,
    take: 'Both change the same shard config; land them together.',
    members: [
      { prKey: sampleKey(first), reason: 'Splits the suite.' },
      { prKey: sampleKey(first + 1), reason: 'Splits the suite next to it.' },
    ],
    removedKeys: [],
    status: 'active',
    inputHash: 'sample',
    createdAt: clock.hoursAgo(5),
    updatedAt: clock.hoursAgo(5),
  };
}

/** The crowded topic: 30 PRs in 25 tiles (five sets of two, twenty singles). */
function crowdedTopic(clock: SampleClock) {
  const built = Array.from({ length: CROWDED_COUNT }, (_, index) => crowdedPr(clock, index));
  const member = (number: number): TileMember => pinged(number, number % 3 === 1 ? 'review_requested' : 'subscribed');
  const tiles: Tile[] = [];
  const sets: PrSet[] = [];
  for (let first = CROWDED_FIRST; first < CROWDED_FIRST + CROWDED_SET_PRS; first += 2) {
    const set = crowdedSet(clock, first);
    sets.push(set);
    tiles.push(sampleTile(STRESS_TOPIC.crowded, 'set', `set:${set.id}`, set.title, [member(first), member(first + 1)]));
  }
  for (let number = CROWDED_FIRST + CROWDED_SET_PRS; number < CROWDED_FIRST + CROWDED_COUNT; number += 1) {
    tiles.push(sampleTile(STRESS_TOPIC.crowded, 'single', `pr:${sampleKey(number)}`, built[number - CROWDED_FIRST]!.pr.title, [member(number)]));
  }
  return {
    prs: built.map((entry) => entry.pr),
    events: built.flatMap((entry) => entry.events),
    glances: built.map((entry) => entry.glance),
    tiles,
    sets,
  };
}

export function stressPack(clock: SampleClock): SamplePack {
  const longName = longNameTopic(clock);
  const crowded = crowdedTopic(clock);
  return {
    topics: buildTopics(clock),
    prs: [...longName.prs, ...crowded.prs],
    events: [...longName.events, ...crowded.events],
    glances: [...longName.glances, ...crowded.glances],
    tiles: [...longName.tiles, ...crowded.tiles],
    sets: crowded.sets,
    userStates: [],
  };
}

/** Every list full and every text at its limit (DOSSIER_LIMITS). */
function boundsDossier(clock: SampleClock): Dossier {
  const limits = DOSSIER_LIMITS;
  return {
    goal: textOf('Every monorepo suite runs on timing-based shards, so no shard takes more than ten minutes.', limits.goal),
    summary: textOf('Every suite in the monorepo moves to timing-based shards.', limits.summary),
    status: 'active',
    statusNote: textOf(`Waiting on reviews for ${CROWDED_COUNT} PRs.`, limits.statusNote),
    people: AUTHORS.slice(0, limits.people).map((login, index) => ({
      login,
      role: index === 1 ? 'driver' : 'contributor',
      note: textOf(`${login} shards the ${SUITES[index]} suite.`, limits.personNote),
    })),
    openQuestions: Array.from({ length: limits.openQuestions }, (_, index) => ({
      text: textOf(`Should the ${SUITES[index]} suite keep a fixed shard for its slowest test?`, limits.questionText),
      askedBy: AUTHORS[index % AUTHORS.length]!,
      refs: [],
    })),
    timeline: Array.from({ length: limits.timeline }, (_, index) => ({
      prKey: sampleKey(CROWDED_FIRST - (limits.timeline - CROWDED_COUNT) + index),
      role: textOf(`Shards the ${SUITES[index % SUITES.length]} suite.`, limits.timelineRole),
    })),
    earlier: textOf('Before timing data existed every suite ran on four fixed shards.', limits.earlier),
    userCares: Array.from({ length: limits.userCares }, (_, index) => ({
      text: textOf(`Shard time of the ${SUITES[index]} suite`, limits.careText),
      source: 'observed' as const,
    })),
    recentChanges: Array.from({ length: limits.recentChanges }, (_, index) => ({
      at: clock.hoursAgo(1 + index * 3),
      text: textOf(`#${CROWDED_FIRST + index} moved the ${SUITES[index % SUITES.length]} suite to timing shards.`, limits.changeText),
      refs: [],
    })),
    relation: { kind: 'team', ownerTeam: 'acme/team-platform', whyYou: textOf('lyra (team-platform) drives it, your team is asked on every shard PR', limits.whyYou) },
  };
}

export function stressPackMemory(clock: SampleClock): SamplePackMemory {
  const version = { topicId: STRESS_TOPIC.crowded, version: 1, dossier: boundsDossier(clock), flags: [], inputHash: 'sample-stress-1', throughSeq: 0, model: 'sample', createdAt: clock.hoursAgo(0.5) };
  return { relations: new Map(), dossiers: new Map([[STRESS_TOPIC.crowded, [version]]]) };
}
