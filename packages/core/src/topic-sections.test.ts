// The ownership sections (DESIGN.md "Ownership sections", 2026-10-02) as a
// scenario table: each row is a sentence, the topic it describes, and the
// section it lands in. The sweeps below the table cover every combination
// of driver, owner team and relation for the rules that must not depend on
// them (an ask, the Archive, a driver over the owner team).
import { describe, expect, it } from 'vitest';
import { emptyTierCounts } from './topic-queues.ts';
import { effectiveDriver, OUTSIDE_DRIVER, TEAM_DRIVER } from './topic-driver.ts';
import { compareInSection, topicDriverView, topicQuiet, topicSection, type TopicSection } from './topic-sections.ts';
import type { PrTier } from './pr-tier.ts';
import type { TopicRelation } from './memory.ts';
import type { Viewer } from './types.ts';

/**
 * jo is on two home teams (team-devex with gabe, team-ci with rio) and one
 * routing team (approvers). jules and gil are outside them.
 */
const jo: Viewer = {
  login: 'jo',
  teams: ['acme/team-devex', 'acme/team-ci', 'acme/approvers'],
  homeTeams: ['acme/team-devex', 'acme/team-ci'],
  teamMembers: ['gabe', 'rio'],
};

const DEVEX = 'acme/team-devex';
const CI = 'acme/team-ci';
const APPROVERS = 'acme/approvers';
const ALERTS = 'acme/team-alerts';

type Ask = 'needs_reply' | 'changes_requested' | 'to_review' | 'team_mentioned';

interface Scenario {
  says: string;
  /** The automatic driver: a login or TEAM_DRIVER (the dossier's driverTeam), null when nobody is known. */
  driver: string | null;
  /** The user's pick in the header menu: a login, TEAM_DRIVER or OUTSIDE_DRIVER. */
  pick?: string;
  /** The dossier's relation; null when the topic has no dossier yet. */
  relation: TopicRelation | null;
  /** The dossier's owner team. */
  owner?: string | null;
  /** PR tiers in the topic, besides the viewer's open PR. */
  tiers?: Partial<Record<PrTier, number>>;
  /** The viewer has an open PR in the topic. */
  yourPr?: boolean;
  /** A live tile is the viewer's move. */
  move?: boolean;
  retired?: boolean;
  viewer?: Viewer;
  section: TopicSection;
}

function sectionOf(scenario: Omit<Scenario, 'says' | 'section'>): TopicSection {
  const viewer = scenario.viewer ?? jo;
  const tiers = { ...emptyTierCounts(), ...scenario.tiers };
  if (scenario.yourPr) {
    tiers.mine += 1;
  }
  return topicSection({
    retired: scenario.retired ?? false,
    queues: { tiers, byYou: scenario.yourPr ? 1 : 0 },
    moves: scenario.move ? 1 : 0,
    driver: effectiveDriver(scenario.pick ?? null, scenario.driver, viewer).relation,
    placement: scenario.relation === null ? null : { relation: scenario.relation, ownerTeam: scenario.owner ?? null },
    homeTeams: viewer.homeTeams ?? viewer.teams,
  });
}

const SCENARIOS: Scenario[] = [
  // Asks pull a topic up while they last, whoever drives it.
  { says: 'jules asked jo a question in a topic jules drives', driver: 'jules', relation: 'routed', tiers: { needs_reply: 1 }, section: 'needs_reply' },
  { says: "a teammate's review request inside jo's own project shows under To review", driver: 'jo', relation: 'team', owner: DEVEX, yourPr: true, tiers: { to_review: 1 }, section: 'to_review' },
  { says: 'a standing change request outranks a review request', driver: 'gil', relation: 'routed', tiers: { changes_requested: 1, to_review: 2 }, section: 'changes_requested' },
  { says: 'a team mention on an FYI topic shows under Team mentioned', driver: 'gil', relation: 'fyi', tiers: { team_mentioned: 1 }, section: 'team_mentioned' },
  { says: 'a review request on a topic without a dossier still shows under To review', driver: null, relation: null, tiers: { to_review: 1 }, section: 'to_review' },
  { says: "a teammate's plain PR asks nothing: jo drives, so You drive", driver: 'jo', relation: 'team', owner: DEVEX, yourPr: true, tiers: { team: 1 }, section: 'you_drive' },

  // Who drives decides, the owner team does not.
  { says: "jo drives, has an open PR, and gabe has one too (was Team's PRs)", driver: 'jo', relation: 'team', owner: DEVEX, yourPr: true, tiers: { team: 1 }, section: 'you_drive' },
  { says: 'jo drives but nothing of theirs is open', driver: 'jo', relation: 'team', owner: DEVEX, tiers: { rest: 4 }, section: 'you_drive' },
  { says: "jo drives work on another team's code", driver: 'jo', relation: 'team', owner: ALERTS, section: 'you_drive' },
  { says: "gabe drives and jo has a PR in it (CI speed): Your team owns", driver: 'gabe', relation: 'team', owner: DEVEX, yourPr: true, section: 'team_owns' },
  { says: 'gabe drives, owned by another team (Python upgrade soak)', driver: 'gabe', relation: 'team', owner: 'acme/team-hogql', section: 'team_owns' },
  { says: 'rio from the second home team drives', driver: 'rio', relation: 'team', owner: CI, section: 'team_owns' },
  { says: 'a teammate drives a topic that reached jo as routed (merge queue lanes)', driver: 'gabe', relation: 'routed', owner: ALERTS, section: 'team_owns' },
  { says: 'jules drives, owner signal says home team, jo has a PR in it (Alerting V2)', driver: 'jules', relation: 'team', owner: DEVEX, yourPr: true, section: 'other_work' },
  { says: 'gil drives a routed review topic', driver: 'gil', relation: 'routed', owner: ALERTS, section: 'other_work' },
  { says: 'jules drives an unread, urgent topic (Replay Vision scanner quality): unread does not place it', driver: 'jules', relation: 'routed', section: 'other_work' },
  { says: 'gil drives and the owner team is unknown', driver: 'gil', relation: 'team', owner: null, section: 'other_work' },

  // Nobody known to drive it: the owner team decides.
  { says: 'a standing topic of the home team, no single driver (Egress)', driver: null, relation: 'team', owner: DEVEX, section: 'team_owns' },
  { says: 'no driver, owned by the second home team', driver: null, relation: 'routed', owner: CI, section: 'team_owns' },
  { says: 'no driver, owned by a bare team slug of a home team', driver: null, relation: 'team', owner: 'team-ci', section: 'team_owns' },
  { says: 'no driver, owned by the routing team (not a home team)', driver: null, relation: 'routed', owner: APPROVERS, section: 'other_work' },
  { says: 'no driver, owned by another team', driver: null, relation: 'routed', owner: ALERTS, section: 'other_work' },
  { says: 'no driver, no owner team, routed', driver: null, relation: 'routed', owner: null, section: 'other_topics' },
  { says: 'no driver, no owner team, but jo has an open PR in it', driver: null, relation: 'team', owner: null, yourPr: true, section: 'other_topics' },

  // No dossier yet.
  { says: 'no dossier and no driver: Other topics, not sorted yet', driver: null, relation: null, section: 'other_topics' },
  { says: 'no dossier, no driver, jo has an open PR: still not sorted yet', driver: null, relation: null, yourPr: true, section: 'other_topics' },
  { says: 'no dossier, an outsider is known to drive it', driver: 'jules', relation: null, section: 'other_work' },
  { says: 'no dossier, a teammate is known to drive it', driver: 'gabe', relation: null, section: 'team_owns' },
  { says: 'no dossier, jo is known to drive it', driver: 'jo', relation: null, section: 'you_drive' },

  // FYI stays FYI unless something stronger holds.
  { says: 'FYI driven by an outsider', driver: 'jules', relation: 'fyi', owner: ALERTS, section: 'other_topics' },
  { says: 'FYI with no driver, owned by a home team', driver: null, relation: 'fyi', owner: DEVEX, section: 'other_topics' },
  { says: 'FYI, but jo has an open PR: by driver', driver: 'jules', relation: 'fyi', yourPr: true, section: 'other_work' },
  { says: 'FYI, but jo has a move on a live tile: by driver', driver: 'gabe', relation: 'fyi', move: true, section: 'team_owns' },
  { says: 'FYI, jo has an open PR, no driver: by owner team', driver: null, relation: 'fyi', owner: CI, yourPr: true, section: 'team_owns' },
  { says: 'FYI, but a teammate drives it', driver: 'rio', relation: 'fyi', section: 'team_owns' },
  { says: 'FYI, but jo drives it', driver: 'jo', relation: 'fyi', section: 'you_drive' },

  // The viewer's teams.
  {
    says: 'teammates never fetched: gabe reads as outside the team',
    driver: 'gabe',
    relation: 'team',
    viewer: { login: 'jo', teams: [DEVEX], homeTeams: [DEVEX] },
    section: 'other_work',
  },
  {
    says: 'roles undecided: every team is home, so the approvers own it for jo',
    driver: null,
    relation: 'routed',
    owner: APPROVERS,
    viewer: { login: 'jo', teams: [DEVEX, APPROVERS], teamMembers: ['gabe'] },
    section: 'team_owns',
  },
  { says: 'no home team: the owner team is never home', driver: null, relation: 'team', owner: DEVEX, viewer: { login: 'jo', teams: [DEVEX], homeTeams: [], teamMembers: [] }, section: 'other_work' },

  // The agent names the team as driver (dossier driverTeam, decision h).
  { says: 'the dossier says the team drives a standing topic owned by another team', driver: TEAM_DRIVER, relation: 'team', owner: ALERTS, section: 'team_owns' },
  { says: 'the team drives an FYI topic: the team counts like a teammate', driver: TEAM_DRIVER, relation: 'fyi', section: 'team_owns' },

  // The user's driver pick beats the automatic driver (decision e).
  { says: 'jo picks You on a topic jules drives', driver: 'jules', pick: 'jo', relation: 'routed', owner: ALERTS, section: 'you_drive' },
  { says: 'jo picks Your team on Egress, which an outsider drives', driver: 'jules', pick: TEAM_DRIVER, relation: 'team', owner: DEVEX, section: 'team_owns' },
  { says: 'jo picks Someone outside your team on a topic gabe drives', driver: 'gabe', pick: OUTSIDE_DRIVER, relation: 'team', owner: DEVEX, section: 'other_work' },
  { says: 'jo hands their own topic to gabe', driver: 'jo', pick: 'gabe', relation: 'team', owner: DEVEX, yourPr: true, section: 'team_owns' },
  { says: 'a pick places a topic that has no driver and no dossier', driver: null, pick: 'jo', relation: null, section: 'you_drive' },
  { says: 'Someone outside your team on an FYI topic stays in Other topics', driver: 'gabe', pick: OUTSIDE_DRIVER, relation: 'fyi', section: 'other_topics' },
  { says: 'an open ask still wins over a pick', driver: 'jules', pick: 'jo', relation: 'routed', tiers: { to_review: 1 }, section: 'to_review' },

  // Archive.
  { says: 'a retired topic sits in the Archive', driver: 'jo', relation: 'team', owner: DEVEX, retired: true, section: 'archive' },
];

describe('topicSection, scenarios', () => {
  for (const { says, section, ...scenario } of SCENARIOS) {
    it(says, () => {
      expect(sectionOf(scenario)).toBe(section);
    });
  }
});

/** Every driver, owner team and relation (null: no dossier) a topic can have. */
const DRIVERS = ['jo', 'gabe', 'rio', 'jules', null];
const OWNERS = [DEVEX, CI, APPROVERS, ALERTS, null];
const RELATIONS: (TopicRelation | null)[] = ['team', 'routed', 'fyi', null];

function everyTopic(): Omit<Scenario, 'says' | 'section'>[] {
  return DRIVERS.flatMap((driver) =>
    OWNERS.flatMap((owner) => RELATIONS.flatMap((relation) => [false, true].map((yourPr) => ({ driver, owner, relation, yourPr })))),
  );
}

describe('topicSection, every combination', () => {
  it('an open ask wins over driver, owner team and relation; the most urgent ask first', () => {
    const asks: Ask[] = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned'];
    for (const topic of everyTopic()) {
      asks.forEach((ask, index) => {
        const lessUrgent = Object.fromEntries(asks.slice(index + 1).map((other) => [other, 1]));
        expect(sectionOf({ ...topic, tiers: { [ask]: 1, ...lessUrgent, team: 1 } }), JSON.stringify(topic)).toBe(ask);
      });
    }
  });

  it('a retired topic is in the Archive, asks or not', () => {
    for (const topic of everyTopic()) {
      expect(sectionOf({ ...topic, retired: true, tiers: { needs_reply: 1 } })).toBe('archive');
    }
  });

  it('a pick decides like that driver would, whatever the automatic driver', () => {
    for (const topic of everyTopic()) {
      for (const pick of ['jo', 'gabe', 'jules', TEAM_DRIVER, OUTSIDE_DRIVER]) {
        const asIfDriving = pick === OUTSIDE_DRIVER ? 'jules' : pick === TEAM_DRIVER ? 'gabe' : pick;
        expect(sectionOf({ ...topic, pick }), JSON.stringify({ topic, pick })).toBe(sectionOf({ ...topic, driver: asIfDriving }));
      }
    }
  });

  it('without an ask, a known driver decides whatever the owner team (FYI aside)', () => {
    const expected: Record<string, TopicSection> = { jo: 'you_drive', gabe: 'team_owns', rio: 'team_owns', jules: 'other_work' };
    for (const topic of everyTopic().filter((entry) => entry.driver !== null && (entry.relation !== 'fyi' || entry.yourPr))) {
      expect(sectionOf(topic), JSON.stringify(topic)).toBe(expected[topic.driver!]);
    }
  });
});

describe('effectiveDriver', () => {
  const rows: { says: string; pick: string | null; automatic: string | null; value: string | null; relation: string | null; picked: boolean }[] = [
    { says: 'the pick beats the automatic driver', pick: 'jo', automatic: 'jules', value: 'jo', relation: 'you', picked: true },
    { says: 'reset (no pick) returns to the automatic driver', pick: null, automatic: 'jules', value: 'jules', relation: 'other', picked: false },
    { says: 'the team from the agent reads as team', pick: null, automatic: TEAM_DRIVER, value: TEAM_DRIVER, relation: 'team', picked: false },
    { says: 'Someone outside your team reads as other', pick: OUTSIDE_DRIVER, automatic: 'gabe', value: OUTSIDE_DRIVER, relation: 'other', picked: true },
    { says: 'Your team beats a teammate the agent named', pick: TEAM_DRIVER, automatic: 'gabe', value: TEAM_DRIVER, relation: 'team', picked: true },
    { says: 'nobody known and no pick', pick: null, automatic: null, value: null, relation: null, picked: false },
  ];
  for (const row of rows) {
    it(row.says, () => {
      expect(effectiveDriver(row.pick, row.automatic, jo)).toEqual({ value: row.value, relation: row.relation, picked: row.picked });
    });
  }
});

describe('topicDriverView', () => {
  it('offers You, each teammate, the team and someone outside, each with the section below the asks', () => {
    const view = topicDriverView({
      topic: { status: 'active', driver: 'jules' },
      driverPick: TEAM_DRIVER,
      queues: { tiers: { ...emptyTierCounts(), to_review: 1 }, byYou: 0 },
      moves: 0,
      placement: { relation: 'routed', ownerTeam: ALERTS },
      viewer: jo,
    });
    expect(view).toMatchObject({ kind: 'team', login: null, picked: true, heldByAsk: 'to_review' });
    expect(view.choices.map((choice) => [choice.value, choice.kind, choice.section, choice.current])).toEqual([
      ['jo', 'you', 'you_drive', false],
      ['gabe', 'person', 'team_owns', false],
      ['rio', 'person', 'team_owns', false],
      [TEAM_DRIVER, 'team', 'team_owns', true],
      [OUTSIDE_DRIVER, 'outside', 'other_work', false],
    ]);
  });
});

describe('compareInSection', () => {
  const topic = (name: string, extra: { byYou?: number; moves?: number; unread?: number; urgent?: number }) => ({
    name,
    group: (extra.urgent ?? 0) > 0 || (extra.moves ?? 0) > 0 ? ('needs_you' as const) : ('quiet' as const),
    urgentUnreadTiles: extra.urgent ?? 0,
    unreadTiles: extra.unread ?? 0,
    queues: { byYou: extra.byYou ?? 0 },
    yourMoves: Array.from({ length: extra.moves ?? 0 }, () => ({ move: 'review' as const, text: 'Review' })),
  });

  it("puts the viewer's open PR or move first, then unread, then the urgency order", () => {
    const quiet = topic('quiet', {});
    const calm = topic('calm', { unread: 1 });
    const urgent = topic('urgent', { unread: 2, urgent: 2 });
    const yourPr = topic('your PR', { byYou: 1 });
    const yourMove = topic('your move', { moves: 1, unread: 1, urgent: 1 });
    const sorted = [quiet, calm, urgent, yourPr, yourMove].sort(compareInSection).map((entry) => entry.name);
    expect(sorted).toEqual(['your move', 'your PR', 'urgent', 'calm', 'quiet']);
  });
});

describe('topicQuiet', () => {
  const row = { section: 'you_drive' as TopicSection, unreadTiles: 0, moves: 0, unseenMergeTiles: 0 };

  const table: [string, Partial<typeof row>, boolean][] = [
    ['an unread tile keeps the row loud', { unreadTiles: 1 }, false],
    ['a your-move chip keeps the row loud', { moves: 1 }, false],
    ['the approved-merge move keeps the row loud, though it is not urgent', { moves: 1 }, false],
    ['a merge without your review you have not seen keeps the row loud', { unseenMergeTiles: 1 }, false],
    ['an ask section keeps the row loud', { section: 'needs_reply' }, false],
    ['changes requested keeps the row loud', { section: 'changes_requested' }, false],
    ['to review keeps the row loud', { section: 'to_review' }, false],
    ['team mentioned keeps the row loud', { section: 'team_mentioned' }, false],
    ['the Archive is never dimmed', { section: 'archive' }, false],
    ['all dealt with in You drive', {}, true],
    ['all dealt with in Your team owns', { section: 'team_owns' }, true],
    ['all dealt with in Other work', { section: 'other_work' }, true],
    ['all dealt with in Other topics', { section: 'other_topics' }, true],
  ];

  it.each(table)('%s', (_sentence, extra, quiet) => {
    expect(topicQuiet({ ...row, ...extra })).toBe(quiet);
  });
});
