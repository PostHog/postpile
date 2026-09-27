import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { topicWithPrs } from '../testing/topics.ts';

const pr = reviewRequestedPr(1);

function setup() {
  const h = makeHarness();
  topicWithPrs(h, 'depot', [pr]);
  return h;
}

describe('glance gaps', () => {
  it('says a PR the call cap skipped is not read yet, until a later sync glances it', async () => {
    const h = setup();

    await h.engine.sync({ agentJobs: ['dossiers', 'glances'], maxAgentCalls: 1 });

    const capped = await h.engine.getPr(pr.key);
    expect(capped?.glance).toBeNull();
    expect(capped?.glanceGap).toMatchObject({ reason: 'call_cap' });
    const tile = (await h.engine.getTopic('depot'))?.tiles[0];
    expect(tile?.prs[0]?.glanceGap?.reason).toBe('call_cap');

    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    const read = await h.engine.getPr(pr.key);
    expect(read?.glance).not.toBeNull();
    expect(read?.glanceGap).toBeNull();
  });

  it('marks a PR the agent gave no usable glance for as failed', async () => {
    const h = setup();
    const noAnswer = () => ({ glances: [], missing: [pr.key], model: 'fake-model' });
    h.agent.answerGlances(noAnswer).answerGlances(noAnswer);

    await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect((await h.engine.getPr(pr.key))?.glanceGap).toMatchObject({ reason: 'failed', detail: 'missing or invalid in the answer' });
  });
});
