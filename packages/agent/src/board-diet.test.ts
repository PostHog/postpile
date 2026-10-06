// The board diet (DESIGN.md "The board diet"): prompts and glance hashes read
// board-shape PRs, which leave out bodies no board rule reads. Their text
// and hashes must be byte-identical to the PR with every body, or every
// glance would go stale on the release that ships the diet.
import { boardShape, type FullPr, type Pr, type Viewer } from '@postpile/core';
import { boardSpecArb, buildBoard, CORPUS, CORPUS_SCENARIOS, CORPUS_VIEWER, corpusPrAfter, PROPERTY_TIMEOUT_MS, propertyRuns } from '@postpile/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { glanceItemInputHash, legacyGlanceItemInputHash, setGroupingTriggers } from './hashes.ts';
import { glanceBatchPrompt } from './prompts/glance-batch.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { batchDetail, fullDetail, prDetails, shortDetail } from './prompts/shared.ts';
import type { GlanceBatchInput } from './service.ts';
import { fullContext, makeDossierVersion, makeTopic } from './test-fixtures.ts';

/** Everything the agent layer derives from a few PRs: detail text, the glance prompt and hashes, the set prompt and triggers. */
function agentOutputs(prs: Pr[], viewer: Viewer): unknown {
  const items = prs.map((pr) => ({ pr, provenance: { kind: 'pinged', reason: 'review_requested' } as const }));
  const glance: GlanceBatchInput = { topic: makeTopic(), dossier: makeDossierVersion(), items, viewer, context: fullContext, attempt: 1 };
  const sets = { topic: makeTopic(), prs, existingSets: [], risks: {}, context: fullContext };
  return {
    details: prs.map((pr) => [fullDetail, shortDetail, batchDetail].map((limits) => prDetails(pr, viewer, limits))),
    glancePrompt: glanceBatchPrompt(glance),
    glanceHashes: items.map((item) => [glanceItemInputHash(glance, item), legacyGlanceItemInputHash(glance, item)]),
    setPrompt: setGroupingPrompt(sets),
    setTriggers: setGroupingTriggers(sets),
  };
}

function boardShapes(prs: FullPr[]): Pr[] {
  return prs.map(boardShape);
}

describe('the board diet in the agent layer', () => {
  it('leaves prompt text and input hashes of every corpus PR byte-identical', () => {
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      const prs = Object.values(CORPUS).map((entry) => corpusPrAfter(scenario.pr, entry));
      expect(agentOutputs(boardShapes(prs), CORPUS_VIEWER)).toEqual(agentOutputs(prs, CORPUS_VIEWER));
    }
  });

  it('leaves prompt text and input hashes of generated boards byte-identical', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        const full = [...board.fullPrs.values()];
        expect(agentOutputs(boardShapes(full), board.viewer)).toEqual(agentOutputs(full, board.viewer));
      }),
      { numRuns: Math.min(propertyRuns(), 200) },
    );
  }, PROPERTY_TIMEOUT_MS);
});
