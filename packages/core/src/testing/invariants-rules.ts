// The rules on one PR against the spec (spec-rules.ts, spec-facts.ts):
// review request, last touch and open ask, whose move, tier, done, the
// unseen count, pings, quiet reads and Look closer pings. Each invariant
// works the answer out from the raw snapshot and the board's events and
// compares it with the app's, both ways: what must not happen and what must
// (DESIGN "Tests across rules").
import { lookCloserPingCheck } from '../glance-pings.ts';
import { displayState } from '../loudness.ts';
import { lookCloserPingText, pingRule, pingTemplate } from '../pings.ts';
import { topicPeople } from '../topic-queues.ts';
import {
  actorsFromQuietDetail,
  botsFromQuietDetail,
  isNewYourMove,
  judgedReadCheck,
  judgedReadDetail,
  lastLookedAt,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  quietReasonFromDetail,
  requestGoneReadCheck,
  requestGoneReadDetail,
  touchedReadCheck,
} from '../quiet-reads.ts';
import type { JudgedReadCheck, QuietReadCheck, RequestGoneReadCheck, TouchedReadCheck } from '../quiet-reads.ts';
import { prAsOf } from '../pr-as-of.ts';
import type { Pr, PrEvent, PrKey, Verdict } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { PropertyBoard } from './build-board.ts';
import { ensure, eventsOf, prOf, type Invariant } from './invariant.ts';
import { SPEC_ADDRESSED_KINDS } from './spec-events.ts';
import { isAutomationLogin, isViewerTeam, newestTouch, pendingRequest, specOwnerRelation, specOwners, specRelation, specSnapshotAt } from './spec-facts.ts';
import {
  effectiveLoudnessOf,
  expectedDone,
  expectedJudgedRead,
  expectedForWhom,
  expectedLookCloser,
  expectedLookCloserText,
  expectedNewMove,
  expectedPing,
  expectedPingText,
  expectedQuietRead,
  expectedRequestGoneRead,
  expectedTier,
  expectedTileForWhom,
  expectedTouchedRead,
  expectedTurn,
  openAsk,
} from './spec-rules.ts';

function allRows(views: TileView[]): PrSummary[] {
  return views.flatMap((view) => view.prs);
}

function turnInput(board: PropertyBoard, key: PrKey) {
  return { pr: prOf(board, key), events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, notYours: board.notYours.has(key) };
}

/** A turn as one comparable line: kind, move, whom it waits on, lead and words. */
function turnLine(turn: { kind: string; move?: string; who: string | null; lead?: string; what: string }): string {
  return JSON.stringify([turn.kind, turn.move ?? null, turn.who, turn.lead ?? null, turn.what]);
}

/** The facts every consumer reads: who a request asks, the viewer's last touch, the open ask, automation author, own team requests. */
export const prFactsMatchTheSpec: Invariant = {
  name: "a PR's review request, last touch, open ask and team requests are the spec's",
  check(board, views) {
    for (const row of allRows(views)) {
      const pr = prOf(board, row.key);
      ensure(row.facts.reviewRequest === pendingRequest(pr, board.viewer), `${row.key}: request ${row.facts.reviewRequest}, expected ${pendingRequest(pr, board.viewer)}`);
      const touch = newestTouch(pr, board.viewer);
      const expectedTouch = touch === null ? null : { kind: touch.kind, at: touch.at };
      ensure(JSON.stringify(row.facts.lastTouch) === JSON.stringify(expectedTouch), `${row.key}: last touch ${JSON.stringify(row.facts.lastTouch)}, expected ${JSON.stringify(expectedTouch)}`);
      const ask = openAsk(pr, eventsOf(board, row.key), board.viewer, SPEC_ADDRESSED_KINDS);
      ensure((row.facts.openAsk?.id ?? null) === (ask?.id ?? null), `${row.key}: open ask ${row.facts.openAsk?.id ?? 'none'}, expected ${ask?.id ?? 'none'}`);
      ensure(row.facts.ownerIsAutomation === specOwners(pr).every(isAutomationLogin), `${row.key}: owner automation ${row.facts.ownerIsAutomation}`);
      const teams = pr.state === 'OPEN' ? pr.reviewerTeams.filter((team) => isViewerTeam(board.viewer, team)) : [];
      ensure(JSON.stringify(row.ownTeamRequests) === JSON.stringify(teams), `${row.key}: own team requests ${row.ownTeamRequests.join(', ')}, expected ${teams.join(', ')}`);
    }
  },
};

/**
 * Whose PR it is (DESIGN "PR ownership"): the row's owners and their
 * relation (Mine and Team filters), and the sidebar faces: every owner who
 * is a person, once, with their relation.
 */
export const ownershipMatchesTheSpec: Invariant = {
  name: 'owners, their relation and the sidebar faces are the spec owners',
  check(board, views) {
    for (const row of allRows(views)) {
      const pr = prOf(board, row.key);
      ensure(JSON.stringify(row.facts.owners) === JSON.stringify(specOwners(pr)), `${row.key}: owners ${row.facts.owners.join(', ')}, expected ${specOwners(pr).join(', ')}`);
      const relation = specOwnerRelation(pr, board.viewer);
      ensure(row.authorRelation === relation, `${row.key}: owner relation ${row.authorRelation}, expected ${relation}`);
    }
    const prs = [...board.prs.values()];
    const people = new Map<string, string>();
    for (const owner of prs.flatMap(specOwners).filter((login) => !isAutomationLogin(login))) {
      people.set(owner.toLowerCase(), `${owner.toLowerCase()}:${specRelation(owner, board.viewer)}`);
    }
    const faces = topicPeople(prs, board.viewer).map((person) => `${person.login.toLowerCase()}:${person.relation}`);
    const expected = [...people.values()];
    ensure(JSON.stringify(faces.toSorted()) === JSON.stringify(expected.toSorted()), `faces ${faces.join(', ')}, expected ${expected.join(', ')}`);
  },
};

/**
 * The for-whom chip of each PR and tile is the spec's (DESIGN "Tile faces",
 * "Team roles"): "Your PR" on an owned PR, "For you" when it is theirs, a
 * sea chip for a home team and a neutral one for a routing team.
 */
export const forWhomMatchesTheSpec: Invariant = {
  name: 'the for-whom chip of each PR and tile is the spec chip, routing teams neutral',
  check(board, views) {
    for (const view of views) {
      for (const row of view.prs) {
        const expected = JSON.stringify(expectedForWhom(row.why, prOf(board, row.key), board.viewer));
        ensure(JSON.stringify(row.forWhom) === expected, `${row.key}: for whom ${JSON.stringify(row.forWhom)} (${row.why}), expected ${expected}`);
      }
      const tile = JSON.stringify(expectedTileForWhom(view.prs.map((row) => row.forWhom)));
      ensure(JSON.stringify(view.forWhom) === tile, `${view.tile.id}: for whom ${JSON.stringify(view.forWhom)}, expected ${tile}`);
    }
  },
};

/**
 * Whose move on each PR is the spec's (DESIGN "Whose turn"): by PR type
 * (reply, re-review, review on someone else's PR; reply, address changes,
 * merge on your own; a draft only reply and your own draft's changes), a
 * review only with a real request and no review of the head, whom a "them"
 * turn waits on, and the footer's words for it.
 */
export const turnMatchesTheSpec: Invariant = {
  name: 'whose move on each PR is the spec move, whom a them turn waits on, and its words',
  check(board, views) {
    for (const row of allRows(views)) {
      const expected = expectedTurn(turnInput(board, row.key));
      const want = turnLine({ ...expected, who: expected.kind === 'them' ? expected.who : null });
      ensure(turnLine(row.turn) === want, `${row.key}: ${turnLine(row.turn)}, expected ${want}`);
      ensure(row.turn.prKey === (row.turn.kind === 'none' ? null : row.key), `${row.key}: turn names ${row.turn.prKey}`);
    }
  },
};

/** The tier is the spec's (DESIGN "Queue sections"); a pulled-in layer is always the rest. */
export const tierMatchesTheSpec: Invariant = {
  name: "each PR's tier is the spec tier, the rest for a pulled-in layer",
  check(board, views) {
    for (const row of allRows(views)) {
      const tier = expectedTier({ ...turnInput(board, row.key), reason: board.threads.get(row.key)?.reason ?? null });
      const expected = row.provenance.kind === 'pulled_in' ? 'rest' : tier;
      ensure(row.tier === expected, `${row.key}: tier ${row.tier}, expected ${expected}`);
    }
  },
};

/**
 * Done by the spec (2026-09-28): an open PR is done only when the viewer
 * approved it or handled it with no review still owed, and it is not their
 * move; a merged or closed one once an unseen merge without their review is
 * seen (or the glance says not theirs).
 */
export const doneMatchesTheSpec: Invariant = {
  name: 'a PR is done exactly when the spec says: approved or handled with nothing owed, or finished and seen',
  check(board, views) {
    for (const row of allRows(views)) {
      const expected = expectedDone({ ...turnInput(board, row.key), lastReadAt: board.threads.get(row.key)?.lastReadAt ?? null });
      ensure(row.done === expected, `${row.key}: done ${row.done}, expected ${expected}`);
    }
  },
};

/** The row's unseen count is its unseen loud events (a found PR counts none: it never makes its tile unread); each event shows as seen or its loudness. */
export const unseenCountMatchesTheSpec: Invariant = {
  name: "a row's unseen count is its unseen loud events, none for a found PR, and each event shows seen or its loudness",
  check(board, views) {
    for (const row of allRows(views)) {
      const loud = eventsOf(board, row.key).filter((event) => event.seenAt === null && effectiveLoudnessOf(event) === 'loud').length;
      const expected = row.provenance.kind === 'found' ? 0 : loud;
      ensure(row.unseenLoudEvents === expected, `${row.key}: unseen ${row.unseenLoudEvents}, expected ${expected}`);
      for (const event of eventsOf(board, row.key)) {
        const shown = event.seenAt === null ? effectiveLoudnessOf(event) : 'seen';
        ensure(displayState(event) === shown, `${event.id}: shows as ${displayState(event)}, expected ${shown}`);
      }
    }
  },
};

function holdingViews(views: TileView[], key: PrKey): TileView[] {
  return views.filter((view) => view.tile.members.some((member) => member.prKey === key));
}

/** A few sets of new events per PR: what the poll brings (unseen since the snooze), everything, and the newest three. */
function pingEventSets(board: PropertyBoard, key: PrKey): PrEvent[][] {
  const events = eventsOf(board, key);
  const since = board.snoozes.get(key)?.since ?? '';
  return [events.filter((event) => event.seenAt === null && event.at > since), events, events.slice(-3)];
}

/**
 * The ping class and the event it is about follow the spec table (DESIGN
 * "Live poll and Mac pings"), both ways: an addressed ask on an open PR in
 * an unsnoozed tile pings, and nothing else does. Checked for quiet repos
 * and snoozed tiles too.
 */
export const pingsMatchTheSpec: Invariant = {
  name: 'the ping class and its event are the spec table: addressed asks ping, nothing else does',
  check(board, views) {
    for (const [key, pr] of board.prs) {
      const snoozed = holdingViews(views, key).some((view) => view.state.kind === 'snoozed');
      for (const events of pingEventSets(board, key)) {
        for (const [quietRepo, snoozedTile] of [[false, snoozed], [true, false], [false, !snoozed]] as const) {
          const rule = pingRule(events, pr, board.viewer, quietRepo, snoozedTile);
          const expected = expectedPing({ pr, events, viewer: board.viewer, quietRepo, snoozed: snoozedTile });
          const got = { class: rule.class, eventId: rule.event?.id ?? null, reason: rule.reason };
          ensure(JSON.stringify(got) === JSON.stringify(expected), `${key}: ping ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
          const loudness = rule.event === null ? 'quiet' : effectiveLoudnessOf(rule.event);
          ensure(rule.loudness === loudness, `${key}: ping loudness ${rule.loudness}, expected ${loudness}`);
        }
      }
      for (const event of eventsOf(board, key)) {
        const text = JSON.stringify(pingTemplate(event, pr));
        const expected = JSON.stringify(expectedPingText(pr, event));
        ensure(text === expected, `${event.id}: ping text ${text}, expected ${expected}`);
      }
    }
  },
};

/**
 * The quiet mark-reads follow the spec's skip lists (DESIGN "Handled
 * quietly", "You already dealt with it", "GitHub unread is PostPile
 * unread"), and mark when nothing on them holds: bot-only activity on
 * someone else's PR gets read, and so does a person's activity the agent
 * judged as not needing the viewer, and a never-opened review request that
 * no longer stands. Whether the tile is unread is no input any more: a thread unread on GitHub
 * always makes it so.
 */
export const quietReadsMatchTheSpec: Invariant = {
  name: 'quiet reads skip for the spec reasons and mark when none holds (bots only, acted after, judged by the agent, request gone)',
  check(board, views) {
    for (const [key, thread] of board.threads) {
      const holding = holdingViews(views, key);
      if (holding.length === 0) {
        continue;
      }
      const pr = prOf(board, key);
      const input = {
        thread,
        pr,
        events: eventsOf(board, key),
        userState: board.userStates.get(key) ?? null,
        viewer: board.viewer,
        notYours: board.notYours.has(key),
        prFetchedAt: board.prFetchedAt.get(key) ?? null,
      };
      const quietCheck = quietReadCheck(input);
      const expectedQuiet = JSON.stringify(expectedQuietRead(input));
      ensure(JSON.stringify(quietCheck) === expectedQuiet, `${key}: bot-only read ${JSON.stringify(quietCheck)}, expected ${expectedQuiet}`);
      const touchedCheck = touchedReadCheck(input);
      const expectedTouched = JSON.stringify(expectedTouchedRead(input));
      ensure(JSON.stringify(touchedCheck) === expectedTouched, `${key}: acted-after read ${JSON.stringify(touchedCheck)}, expected ${expectedTouched}`);
      const judgedCheck = judgedReadCheck(input);
      const expectedJudged = JSON.stringify(expectedJudgedRead(input));
      ensure(JSON.stringify(judgedCheck) === expectedJudged, `${key}: judged read ${JSON.stringify(judgedCheck)}, expected ${expectedJudged}`);
      const requestGoneCheck = requestGoneReadCheck(input);
      const expectedRequestGone = JSON.stringify(expectedRequestGoneRead(input));
      ensure(JSON.stringify(requestGoneCheck) === expectedRequestGone, `${key}: request-gone read ${JSON.stringify(requestGoneCheck)}, expected ${expectedRequestGone}`);
      quietDetailsReadBack(key, quietCheck, touchedCheck, judgedCheck, requestGoneCheck);
    }
  },
};

/** The action log detail of a quiet read gives its reason (and who acted) back, so the Handled quietly view can say why. */
function quietDetailsReadBack(key: PrKey, quiet: QuietReadCheck, touched: TouchedReadCheck, judged: JudgedReadCheck, requestGone: RequestGoneReadCheck): void {
  if (quiet.kind === 'mark') {
    const detail = quietReadDetail(quiet.bots);
    ensure(JSON.stringify(botsFromQuietDetail(detail)) === JSON.stringify(quiet.bots) && quietReasonFromDetail(detail) === 'bots', `${key}: "${detail}" does not read back`);
  }
  if (touched.kind === 'mark') {
    const detail = quietReasonDetail(touched.reason);
    ensure(quietReasonFromDetail(detail) === touched.reason && botsFromQuietDetail(detail).length === 0, `${key}: "${detail}" does not read back`);
  }
  if (judged.kind === 'mark') {
    const detail = judgedReadDetail(judged.actors);
    ensure(quietReasonFromDetail(detail) === 'judged' && JSON.stringify(actorsFromQuietDetail(detail)) === JSON.stringify(judged.actors), `${key}: "${detail}" does not read back`);
  }
  if (requestGone.kind === 'mark') {
    const detail = requestGoneReadDetail(requestGone.actors);
    ensure(quietReasonFromDetail(detail) === 'request_gone' && JSON.stringify(actorsFromQuietDetail(detail)) === JSON.stringify(requestGone.actors), `${key}: "${detail}" does not read back`);
  }
}

const VERDICTS: (Verdict | null)[] = [null, 'LOOKS_SAFE', 'LOOK_CLOSER', 'NOT_YOURS'];

/** A glance's for-you line of two sentences: the ping quotes the first. */
const FOR_YOU = 'Routed to your team. Touches the billing job.';

/** The Look closer ping follows the spec for every verdict, snoozed or not, pinged before for this request, another one or never. */
export const lookCloserMatchesTheSpec: Invariant = {
  name: 'a Look closer ping follows the spec: routed, unreviewed, unsnoozed, once per request',
  check(board) {
    for (const [key, pr] of board.prs) {
      const userState = board.userStates.get(key) ?? null;
      const open = expectedLookCloser({ pr, viewer: board.viewer, verdict: 'LOOK_CLOSER', userState, snoozed: false, pingedRequestId: null });
      const requestIds = [null, 'an-older-request', open.kind === 'ping' ? open.requestId : `pending:${pr.reviewerTeams[0] ?? 'none'}`];
      for (const verdict of VERDICTS) {
        for (const snoozed of [false, true]) {
          for (const pingedRequestId of requestIds) {
            const input = { pr, viewer: board.viewer, userState, snoozed, pingedRequestId };
            const got = JSON.stringify(lookCloserPingCheck({ ...input, glance: verdict === null ? null : { verdict } }));
            const expectedCheck = expectedLookCloser({ ...input, verdict });
            const expected = JSON.stringify(expectedCheck);
            ensure(got === expected, `${key}: Look closer ${got}, expected ${expected}`);
            if (expectedCheck.kind === 'ping') {
              const text = JSON.stringify(lookCloserPingText(pr, expectedCheck.team, { forYou: FOR_YOU }));
              const expectedText = JSON.stringify(expectedLookCloserText(pr, expectedCheck.team, 'Routed to your team.'));
              ensure(text === expectedText, `${key}: Look closer text ${text}, expected ${expectedText}`);
            }
          }
        }
      }
    }
  },
};

/** What the PR as of a boundary says, as one comparable line (request lists as sets). */
function asOfLine(pr: Pr): string {
  const sorted = (list: string[]) => list.map((item) => item.toLowerCase()).toSorted();
  return JSON.stringify([pr.state, pr.isDraft, pr.reviewDecision, pr.headOid, sorted(pr.reviewerUsers), sorted(pr.reviewerTeams), pr.reviews.map((review) => review.id), pr.comments.map((comment) => comment.id), pr.timeline.map((item) => item.id)]);
}

/**
 * Whether the viewer's move is new since a boundary (the thread's read, the
 * last look) is the spec's (DESIGN "Handled quietly" › New moves only):
 * worked out on the snapshot as it stood then, restated from raw fields
 * (`specSnapshotAt`). Checked at both boundaries on every PR with a thread,
 * whatever the quiet reads decided first.
 */
export const newMoveMatchesTheSpec: Invariant = {
  name: 'a move counts as new since the read exactly when the spec says, on the PR as it stood then',
  check(board) {
    for (const [key, thread] of board.threads) {
      const pr = prOf(board, key);
      const input = { pr, events: eventsOf(board, key), userState: board.userStates.get(key) ?? null, viewer: board.viewer, notYours: board.notYours.has(key) };
      const boundaries = [thread.lastReadAt, lastLookedAt(thread, pr, input.events, board.viewer)].filter((time): time is string => time !== null);
      for (const since of boundaries) {
        ensure(asOfLine(prAsOf(pr, since)) === asOfLine(specSnapshotAt(pr, since)), `${key}: PR as of ${since} ${asOfLine(prAsOf(pr, since))}, expected ${asOfLine(specSnapshotAt(pr, since))}`);
        const got = isNewYourMove(input, since);
        const want = expectedNewMove(input, since);
        ensure(got === want, `${key}: new move since ${since} ${got}, expected ${want}`);
      }
    }
  },
};

export const RULE_INVARIANTS: readonly Invariant[] = [
  prFactsMatchTheSpec,
  ownershipMatchesTheSpec,
  forWhomMatchesTheSpec,
  turnMatchesTheSpec,
  tierMatchesTheSpec,
  doneMatchesTheSpec,
  unseenCountMatchesTheSpec,
  pingsMatchTheSpec,
  quietReadsMatchTheSpec,
  newMoveMatchesTheSpec,
  lookCloserMatchesTheSpec,
];
