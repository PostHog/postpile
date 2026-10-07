// Invariants across rules on real-shaped boards (DESIGN.md "Rules layer: one
// home per fact", "Tests across rules"). The sample boards run the same
// checks in apps/server; these cover shapes the sample lacks: a done PR on a
// live tile, a snoozed tile holding a done PR, routed team requests.
import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeEvent, makePr, makeReview, makeThreadFor, makeUserState, NO_OPENED_READ_INPUT, viewer as baseViewer } from './fixtures.ts';
import type { PaneOffers } from './offers.ts';
import { deriveTileState } from './tiles.ts';
import { buildPrSummary, buildTileView } from './tile-view.ts';
import type { FullPr as Pr, PrEvent, PrKey, Snooze, Tile, TileMember, UserPrState, Viewer } from './types.ts';
import type { TileView } from './views.ts';

const viewer: Viewer = { ...baseViewer, teamMembers: ['lyra', 'rowan'] };
const TEAM = 'acme/team-platform';
const NOW = at(100);

interface BoardInput {
  prs: Pr[];
  /** Extra events on top of the ones derived from each PR. */
  events?: PrEvent[];
  userStates?: UserPrState[];
  snoozes?: Snooze[];
  notYours?: PrKey[];
  /** PRs whose thread is unread on GitHub; every other thread is read. */
  unreadKeys?: PrKey[];
}

function tileOf(prs: Pr[]): Tile {
  const members: TileMember[] = prs.map((pr) => ({ prKey: pr.key, provenance: { kind: 'pinged', reason: 'review_requested' } }));
  const kind = prs.length > 1 ? 'set' : 'single';
  return { id: kind === 'set' ? 'set:s1' : `pr:${prs[0]!.key}`, topicId: 'topic-1', kind, title: 'T', members, stacks: [] };
}

/** One tile over the PRs, built the way the engine and the fake engine build it. */
function tileView(input: BoardInput): TileView {
  const tile = tileOf(input.prs);
  const prs = new Map(input.prs.map((pr) => [pr.key, pr]));
  const userStates = new Map((input.userStates ?? []).map((state) => [state.prKey, state]));
  const events = new Map<PrKey, PrEvent[]>();
  for (const pr of input.prs) {
    const extra = (input.events ?? []).filter((event) => event.prKey === pr.key);
    events.set(pr.key, [...deriveEvents(pr, viewer, userStates.get(pr.key) ?? null), ...extra]);
  }
  const notYours = new Set(input.notYours ?? []);
  const snoozes = new Map((input.snoozes ?? []).map((snooze) => [snooze.prKey, snooze]));
  const threads = new Map((input.unreadKeys ?? []).map((key) => [key, makeThreadFor(prs.get(key)!)]));
  const state = deriveTileState({ tile, prs, events, threads, snoozes, userStates, now: NOW, viewer, notYours });
  const rows = tile.members.map((member) => {
    const pr = prs.get(member.prKey)!;
    return buildPrSummary({
      pr,
      member,
      viewer,
      userState: userStates.get(pr.key) ?? null,
      events: events.get(pr.key) ?? [],
      reason: 'review_requested',
      // The row reads NOT_YOURS off the stored glance, like the engine.
      glance: notYours.has(pr.key) ? { verdict: 'NOT_YOURS', forYou: 'Routed to lyra.', risk: 'low' } : null,
      glanceStale: false,
      glanceGap: null,
      glanceRefreshBlock: null,
      glanceState: 'none',
      quietRepo: false,
      repoLabel: null,
      tileUnread: state.kind === 'unread',
      unreadOnGitHub: threads.get(pr.key)?.unread === true,
      lastReadAt: threads.get(pr.key)?.lastReadAt ?? null,
      now: NOW,
      pendingWrite: null,
      opened: NO_OPENED_READ_INPUT,
    });
  });
  return buildTileView({ tile, state, prs: rows, agentPrs: [], prsByKey: prs, events, userStates, viewer, notYours, pendingWrite: null, quietRepo: false, repoLabel: null, now: NOW });
}

function paneOf(view: TileView, key: PrKey): PaneOffers {
  const pane = view.offers.pane[key];
  if (!pane) {
    throw new Error(`no pane offers for ${key}`);
  }
  return pane;
}

const ONLY_OPEN = { lead: 'none', approve: false, ask: false, markLabel: null, removeTeams: [] };

/** ada's open PR the viewer marked done earlier, with nothing asked of them. */
const handledPr = makePr({ number: 1, author: 'ada' });
const handled = makeUserState({ prKey: handledPr.key, handledAt: at(50) });
/** ada's PR that asks the viewer for a review. */
const reviewPr = makePr({ number: 2, author: 'ada', reviewerUsers: [viewer.login] });

describe('a done tile or done PR offers only Open', () => {
  // Bug fixed 2026-09-29: a handled PR by someone else with no ask still got a primary Approve.
  it('on a done single-PR tile', () => {
    const view = tileView({ prs: [handledPr], userStates: [handled] });
    expect(view.state.kind).toBe('done');
    expect(view.offers).toMatchObject({ footer: 'open', markLabel: null });
    expect(paneOf(view, handledPr.key)).toMatchObject({ ...ONLY_OPEN, snooze: false });
  });

  it('on a done PR of a set that still asks for a review', () => {
    const view = tileView({ prs: [handledPr, reviewPr], userStates: [handled] });
    expect(view.state.kind).not.toBe('done');
    expect(view.prs.find((pr) => pr.key === handledPr.key)?.done).toBe(true);
    expect(paneOf(view, handledPr.key)).toMatchObject({ ...ONLY_OPEN, snooze: false });
    expect(paneOf(view, reviewPr.key)).toMatchObject({ lead: 'approve', approve: true });
  });

  it('except Mark read while the done PR has news that keeps its tile unread', () => {
    const news = makeEvent({ id: 'n1', prKey: handledPr.key, kind: 'comment', actor: 'ada', ruleLoudness: 'loud', at: at(60) });
    const view = tileView({ prs: [handledPr], events: [news], userStates: [handled], unreadKeys: [handledPr.key] });
    expect(view.state.kind).toBe('unread');
    expect(view.prs[0]?.done).toBe(true);
    expect(paneOf(view, handledPr.key)).toMatchObject({ lead: 'mark_read', markLabel: 'Mark read', approve: false, ask: false, removeTeams: [] });
  });

  it('and Mark read while the done PR only has its thread unread on GitHub', () => {
    const view = tileView({ prs: [handledPr], userStates: [handled], unreadKeys: [handledPr.key] });
    expect(view.state).toMatchObject({ kind: 'unread', loud: false });
    expect(paneOf(view, handledPr.key)).toMatchObject({ lead: 'mark_read', markLabel: 'Mark read', approve: false, ask: false, removeTeams: [] });
  });

  it('on a snoozed tile whose PR is done: footer and pane lead with Open, and Snooze takes the snooze back', () => {
    const snooze: Snooze = { prKey: handledPr.key, condition: { kind: 'until_time', until: at(500) }, since: at(55) };
    const view = tileView({ prs: [handledPr], userStates: [handled], snoozes: [snooze] });
    expect(view.state.kind).toBe('snoozed');
    expect(view.offers).toMatchObject({ footer: 'open', markLabel: null, snooze: true });
    expect(paneOf(view, handledPr.key)).toMatchObject({ ...ONLY_OPEN, snooze: true });
  });
});

describe('the lead PR is the PR of the tile turn', () => {
  it('on a set where only the second PR is your move', () => {
    const view = tileView({ prs: [handledPr, reviewPr], userStates: [handled] });
    expect(view.turn).toMatchObject({ kind: 'you', prKey: reviewPr.key });
    expect(view.offers.leadPrKey).toBe(reviewPr.key);
  });
});

describe('the pane names the move of each PR, not of its tile', () => {
  it('on a set where the PRs wait on different people', () => {
    const approved = makePr({ number: 3, author: 'ada', reviews: [makeReview({ author: viewer.login, state: 'APPROVED', commitOid: 'head', submittedAt: at(20) })] });
    const view = tileView({ prs: [reviewPr, approved] });
    expect(view.turn).toMatchObject({ kind: 'you', prKey: reviewPr.key });
    expect(view.prs.find((pr) => pr.key === approved.key)?.turn).toMatchObject({ kind: 'them', who: 'ada', what: 'to merge' });
  });
});

describe('same events twice give the same facts', () => {
  it('for every row and the tile', () => {
    const news = makeEvent({ id: 'n1', prKey: handledPr.key, kind: 'comment', actor: 'ada', ruleLoudness: 'loud', at: at(60) });
    const input: BoardInput = { prs: [handledPr, reviewPr], events: [news], userStates: [handled] };
    expect(tileView(input)).toEqual(tileView(input));
  });
});

// Tier and whose move are separate rules that agree on "To review" and
// "Review", except where they differ on purpose: a team request routed to
// someone else stays in the team's To review while it is not the viewer's
// move (DESIGN.md "Look closer pings", team coverage).
describe('tier To review and whose move Review', () => {
  function row(input: BoardInput) {
    return tileView(input).prs[0]!;
  }

  it('agree on a personal request, also after a dismissed review', () => {
    const dismissed = makeReview({ author: viewer.login, state: 'DISMISSED', commitOid: 'head', submittedAt: at(20) });
    for (const pr of [reviewPr, { ...reviewPr, reviews: [dismissed] }]) {
      const summary = row({ prs: [pr] });
      expect(summary.tier).toBe('to_review');
      expect(summary.turn).toMatchObject({ kind: 'you', move: 'review' });
    }
  });

  it('agree on a team request with nobody on it', () => {
    const summary = row({ prs: [makePr({ number: 4, author: 'ada', reviewerTeams: [TEAM] })] });
    expect(summary.tier).toBe('to_review');
    expect(summary.turn).toMatchObject({ kind: 'you', move: 'review' });
  });

  it('differ on purpose when the agent says the team request is not yours', () => {
    const pr = makePr({ number: 5, author: 'ada', reviewerTeams: [TEAM] });
    const summary = row({ prs: [pr], notYours: [pr.key] });
    expect(summary.tier).toBe('to_review');
    expect(summary.turn.kind).toBe('none');
  });

  it('differ on purpose while another reviewer holds changes on a team request', () => {
    const changes = makeReview({ author: 'bob', state: 'CHANGES_REQUESTED', commitOid: 'head', submittedAt: at(20) });
    const summary = row({ prs: [makePr({ number: 6, author: 'ada', reviewerTeams: [TEAM], reviews: [changes] })] });
    expect(summary.tier).toBe('to_review');
    expect(summary.turn).toMatchObject({ kind: 'them', who: 'ada' });
  });
});
