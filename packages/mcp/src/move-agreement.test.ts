// MCP and the detail pane name the same move (DESIGN.md "Rules layer: one
// home per fact", "Consumers agree"), checked on every PR of the sample
// boards, stacks and sets included.
import { FakeEngine } from '@postpile/server';
import { describe, expect, it } from 'vitest';
import { prContext, type ReadContext } from './reads.ts';
import { turnText } from './text.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const MOVE_LINE = /^(Your move|Their move|Nobody's move)/;

/** The move lines before the "Its tile:" line, which is the only one that names the tile's move. */
function prMoveLines(text: string): string[] {
  const head = text.split('Its tile:')[0] ?? '';
  return head.split('\n').filter((line) => MOVE_LINE.test(line));
}

describe('pr_context and the pane', () => {
  it('name the same move for every sample PR', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const ctx: ReadContext = { reader: engine, now: () => NOW, appRunning: () => true };
    const topicIds = [...(await engine.listTopics()).map((item) => item.topic.id), ...(await engine.listFinishedTopics()).map((topic) => topic.id)];
    let checked = 0;
    let onMultiPrTiles = 0;
    for (const topicId of topicIds) {
      for (const view of (await engine.getTopic(topicId))?.tiles ?? []) {
        for (const row of view.prs) {
          // pr_context reads the tiles of the PR's own topic. The sample puts two
          // set members in other topics that hold no tile for them.
          if ((await engine.getPr(row.key))?.topicId !== topicId) {
            continue;
          }
          const answer = await prContext(ctx, row.key, 'brief');
          expect(prMoveLines(answer.text), row.key).toEqual([turnText(row.turn)]);
          checked += 1;
          onMultiPrTiles += view.tile.members.length > 1 ? 1 : 0;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(onMultiPrTiles).toBeGreaterThan(0);
  });
});
