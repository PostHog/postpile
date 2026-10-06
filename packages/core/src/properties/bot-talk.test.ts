// Bot talk changes no agent work and answers nobody (DESIGN.md "Bot talk
// leaves agent work"): a person's "fixed" to a review bot, the empty review
// GitHub wraps it in, "@codex review" and "/trunk merge" added to any
// generated PR leave every earlier event as it was, and are quiet chatter
// themselves: noise for topic memory, nothing for the events agent, nothing
// loud on the tile. They also leave whose turn, the open ask, the viewer's
// last touch, a person's headline and snooze wake-ups as they were, the
// viewer's own bot talk included. The glance hash half is in
// packages/agent/src/bot-talk.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { changesAnswered } from '../changes-answered.ts';
import { isMemoryNoise } from '../event-roles.ts';
import { deriveEvents } from '../events.ts';
import { headlineClass, pickHeadlineEvent } from '../headline.ts';
import { PERSONAL_ASK_KINDS } from '../kinds.ts';
import { lastTouch } from '../last-touch.ts';
import { isBot } from '../bots.ts';
import { awaitsJudgement } from '../quiet-reads.ts';
import { snoozePhase } from '../snooze.ts';
import { boardSpecArb, buildBoard, LOGINS, PROPERTY_TIMEOUT_MS, propertyRuns, withBotTalk } from '../testing/index.ts';
import type { FullPr, IsoTime, PrEvent, SnoozeCondition, UserPrState, Viewer } from '../types.ts';
import { prWhoseTurn, unansweredAsk } from '../whose-turn.ts';

/** What an event is to the rules, without the per-board seen state. */
function ruled(event: PrEvent): unknown {
  return [event.id, event.kind, event.actor, event.ruleLoudness, event.ruleReason, event.chatter];
}

/** People who can talk to bots on this PR: its author when a person, someone from outside, and the viewer. */
function talkers(pr: FullPr): string[] {
  const author = pr.author !== '' && !isBot(pr.author) && pr.author !== LOGINS.viewer ? [pr.author] : [];
  return [...author, LOGINS.outsider, LOGINS.viewer];
}

/** A millisecond before the first event the bot talk added: a snooze started then sees only the bot talk after it. */
function justBefore(added: PrEvent[]): IsoTime {
  const first = added.map((event) => event.at).toSorted()[0]!;
  return new Date(Date.parse(first) - 1).toISOString();
}

const SNOOZES: SnoozeCondition[] = [{ kind: 'someone_replies' }, { kind: 'muted' }];

/** What the viewer sees decided on the PR: whose turn, the open ask, their last touch, the changes answer. */
function decided(pr: FullPr, events: PrEvent[], viewer: Viewer, userState: UserPrState | null): unknown {
  return {
    turn: prWhoseTurn({ pr, events, userState, viewer }),
    ask: unansweredAsk(pr, events, viewer)?.id ?? null,
    touch: lastTouch(pr, events, viewer),
    changes: changesAnswered(pr, viewer),
  };
}

describe('bot talk changes no agent work', () => {
  it('leaves earlier events as they were and adds only quiet chatter nobody judges', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        for (const [key, pr] of board.fullPrs) {
          const userState = board.userStates.get(key) ?? null;
          const before = deriveEvents(pr, board.viewer, userState);
          for (const person of talkers(pr)) {
            const noisy = withBotTalk(pr, person);
            const after = deriveEvents(noisy, board.viewer, userState);
            const earlier = new Set(before.map((event) => event.id));
            expect(after.filter((event) => earlier.has(event.id)).map(ruled)).toEqual(before.map(ruled));
            const added = after.filter((event) => !earlier.has(event.id) && event.actor === person);
            expect(added.length).toBe(4);
            for (const event of added) {
              expect(event.chatter, event.id).toBe(true);
              expect(event.ruleLoudness, event.id).toBe('quiet');
              expect(PERSONAL_ASK_KINDS.includes(event.kind), event.id).toBe(false);
              expect(isMemoryNoise(event), event.id).toBe(true);
              expect(awaitsJudgement(event, noisy, board.viewer), event.id).toBe(false);
            }
          }
        }
      }),
      { numRuns: Math.min(propertyRuns(), 200) },
    );
  }, PROPERTY_TIMEOUT_MS);

  it('answers nobody: whose turn, asks, the headline and snoozes stay as they were', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        const viewer = board.viewer;
        for (const [key, pr] of board.fullPrs) {
          const userState = board.userStates.get(key) ?? null;
          const before = deriveEvents(pr, viewer, userState);
          const headline = pickHeadlineEvent(before, pr, viewer);
          for (const person of talkers(pr)) {
            const noisy = withBotTalk(pr, person);
            const after = deriveEvents(noisy, viewer, userState);
            expect(decided(noisy, after, viewer, userState), person).toEqual(decided(pr, before, viewer, userState));
            // Bot talk ranks with other people's quiet events: it never leads over a person's comment, verdict or ask.
            if (headline !== undefined && headlineClass(headline, pr, viewer) < 4) {
              expect(pickHeadlineEvent(after, noisy, viewer)?.id, person).toBe(headline.id);
            }
            const earlier = new Set(before.map((event) => event.id));
            const since = justBefore(after.filter((event) => !earlier.has(event.id)));
            for (const condition of SNOOZES) {
              const snooze = { prKey: pr.key, condition, since };
              const now = new Date(Date.parse(since) + 3_600_000).toISOString();
              const phaseBefore = snoozePhase(snooze, { pr, events: before, now, viewer });
              expect(snoozePhase(snooze, { pr: noisy, events: after, now, viewer }), `${person} ${condition.kind}`).toBe(phaseBefore);
            }
          }
        }
      }),
      { numRuns: Math.min(propertyRuns(), 200) },
    );
  }, PROPERTY_TIMEOUT_MS);
});
