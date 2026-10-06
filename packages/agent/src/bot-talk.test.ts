// Bot talk changes no agent work (DESIGN.md "Bot talk leaves agent work"): a person's "fixed"
// to a review bot, the empty review GitHub wraps it in, "@codex review" and
// "/trunk merge" added to any generated PR leave its glance hash and the PR
// text every prompt reads byte-identical. The event half is in
// packages/core/src/properties/bot-talk.test.ts.
import { isBot, type Pr, type Viewer } from '@postpile/core';
import { boardSpecArb, buildBoard, LOGINS, PROPERTY_TIMEOUT_MS, propertyRuns, withBotTalk } from '@postpile/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { glanceItemInputHash } from './hashes.ts';
import { batchDetail, fullDetail, prDetails } from './prompts/shared.ts';
import type { GlanceBatchInput } from './service.ts';
import { fullContext, makeDossierVersion, makeTopic } from './test-fixtures.ts';

/** What the agent layer reads of one PR: its glance hash and its detail text. */
function agentView(pr: Pr, viewer: Viewer): unknown {
  const item = { pr, provenance: { kind: 'pinged', reason: 'review_requested' } } as const;
  const input: GlanceBatchInput = { topic: makeTopic(), dossier: makeDossierVersion(), items: [item], viewer, context: fullContext, attempt: 1 };
  return { hash: glanceItemInputHash(input, item), full: prDetails(pr, viewer, fullDetail), batch: prDetails(pr, viewer, batchDetail) };
}

describe('bot talk in the agent layer', () => {
  it('leaves the glance hash and prompt text of generated PRs unchanged', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        for (const pr of board.fullPrs.values()) {
          const people = pr.author !== '' && !isBot(pr.author) && pr.author !== LOGINS.viewer ? [pr.author, LOGINS.outsider] : [LOGINS.outsider];
          for (const person of people) {
            expect(agentView(withBotTalk(pr, person), board.viewer)).toEqual(agentView(pr, board.viewer));
          }
        }
      }),
      { numRuns: Math.min(propertyRuns(), 200) },
    );
  }, PROPERTY_TIMEOUT_MS);
});
