// Bot talk changes no agent work (DESIGN.md "Bot talk leaves agent work"): a person's "fixed"
// to a review bot, the empty review GitHub wraps it in, "@codex review" and
// "/trunk merge" added to any generated PR leave every earlier event as it
// was, and are quiet chatter themselves: noise for topic memory, nothing for the
// events agent, nothing loud on the tile. The glance hash half is in
// packages/agent/src/bot-talk.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isMemoryNoise } from '../event-roles.ts';
import { deriveEvents } from '../events.ts';
import { PERSONAL_ASK_KINDS } from '../kinds.ts';
import { isBot } from '../bots.ts';
import { awaitsJudgement } from '../quiet-reads.ts';
import { boardSpecArb, buildBoard, LOGINS, PROPERTY_TIMEOUT_MS, propertyRuns, withBotTalk } from '../testing/index.ts';
import type { FullPr, PrEvent } from '../types.ts';

/** What an event is to the rules, without the per-board seen state. */
function ruled(event: PrEvent): unknown {
  return [event.id, event.kind, event.actor, event.ruleLoudness, event.ruleReason, event.chatter];
}

/** People who can talk to bots on this PR: its author when a person, and someone from outside. Never the viewer. */
function talkers(pr: FullPr): string[] {
  const author = pr.author !== '' && !isBot(pr.author) && pr.author !== LOGINS.viewer ? [pr.author] : [];
  return [...author, LOGINS.outsider];
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
});
