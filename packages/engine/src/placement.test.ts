import { emptyDossier } from '@postpile/core';
import { makeComment, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { MAX_NEW_AREAS_PER_SYNC } from './digest/dossiers.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic } from './testing/topics.ts';

const routed = { kind: 'routed' as const, ownerTeam: 'acme/team-infra', whyYou: 'team-platform review requested' };

/** n topics with one PR each; every dossier answer gets the given area and relation. */
function topics(h: Harness, count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const pr = reviewRequestedPr(index + 1);
    const id = `topic-${index}`;
    h.reader.addPr(pr, makeThreadFor(pr));
    h.store.topics.create(makeTopic(id));
    h.store.memberships.assign({ prKey: pr.key, topicId: id, assignedBy: 'user', reason: '', createdAt: '2026-09-01T00:00:00.000Z' });
    ids.push(id);
  }
  return ids;
}

describe('topic placement', () => {
  it('shows the dossier relation and area, and hands rule signals to the dossier update', async () => {
    const h = makeHarness();
    const [id] = topics(h, 1);
    h.agent.answerDossier(() => ({ dossier: { ...emptyDossier(), summary: 's', relation: routed }, area: 'CI' }));

    await h.engine.sync({ agentJobs: ['dossiers'] });

    const item = (await h.engine.listTopics()).find((entry) => entry.topic.id === id);
    expect(item?.placement).toEqual({ relation: 'routed', ownerTeam: 'acme/team-infra', whyYou: 'team-platform review requested', area: 'CI', corrected: false });
    expect((await h.engine.getTopic(id!))?.placement?.area).toBe('CI');
    expect(h.agent.dossierInputs[0]?.relationSignals.whyYou).toBe('your review requested');
  });

  it('caps new areas per sync and reuses areas in use', async () => {
    const h = makeHarness();
    const ids = topics(h, MAX_NEW_AREAS_PER_SYNC + 2);
    ids.forEach((_, index) => {
      h.agent.answerDossier(() => ({ area: index === ids.length - 1 ? 'area 0' : `Area ${index}` }));
    });

    await h.engine.sync({ agentJobs: ['dossiers'] });

    const areas = ids.map((id) => h.store.topics.get(id)?.area ?? null);
    expect(new Set(areas.filter((area) => area !== null))).toEqual(new Set(['Area 0', 'Area 1', 'Area 2']));
    expect(areas[MAX_NEW_AREAS_PER_SYNC]).toBeNull();
    // The last answer names an area in use, in another case: it reuses it.
    expect(areas.at(-1)).toBe('Area 0');
  });

  it('lets "Wrong" on the relation win until something new happens', async () => {
    const h = makeHarness();
    const [id] = topics(h, 1);
    h.agent.answerDossier(() => ({ dossier: { ...emptyDossier(), summary: 's', relation: routed } }));
    await h.engine.sync({ agentJobs: ['dossiers'] });

    const result = await h.engine.correctMemory({ kind: 'wrong', factId: null, topicId: id!, text: 'Routed to you', relation: 'fyi' });

    expect(result.ok).toBe(true);
    expect((await h.engine.getTopic(id!))?.placement).toMatchObject({ relation: 'fyi', corrected: true });
    expect(h.store.feedback.recentForTopic(id!, 1)[0]?.note).toContain('it is actually: fyi');

    const pr = reviewRequestedPr(1, { updatedAt: '2026-09-02T11:00:00.000Z', reviews: [{ id: 'r9', author: 'bob', state: 'COMMENTED', body: 'hm', submittedAt: '2026-09-02T11:00:00.000Z', commitOid: 'head' }] });
    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: '2026-09-02T13:00:00.000Z' }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.getTopic(id!))?.placement).toMatchObject({ relation: 'routed', corrected: false });
  });

  it('keeps "Wrong" on the relation through bot noise: a status comment edit is nothing new', async () => {
    const h = makeHarness();
    const [id] = topics(h, 1);
    h.agent.answerDossier(() => ({ dossier: { ...emptyDossier(), summary: 's', relation: routed } }));
    await h.engine.sync({ agentJobs: ['dossiers'] });
    await h.engine.correctMemory({ kind: 'wrong', factId: null, topicId: id!, text: 'Routed to you', relation: 'fyi' });

    const status = { id: 'c-trunk', author: 'trunk-io[bot]', body: 'Merging to `master` is managed by Trunk.', createdAt: '2026-09-02T10:00:00.000Z' };
    const edited = { ...status, lastEditedAt: '2026-09-02T11:00:00.000Z', editor: 'trunk-io[bot]' };
    const pr = reviewRequestedPr(1, { updatedAt: '2026-09-02T11:00:00.000Z', comments: [makeComment(edited)] });
    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: '2026-09-02T13:00:00.000Z' }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.getTopic(id!))?.placement).toMatchObject({ relation: 'fyi', corrected: true });
  });

  it('files area merges from consolidation once and applies them on accept', async () => {
    const h = makeHarness();
    const ids = topics(h, 2);
    h.store.topics.setArea(ids[0]!, 'CI', '2026-09-01T00:00:00.000Z');
    h.store.topics.setArea(ids[1]!, 'CI & tests', '2026-09-01T00:00:00.000Z');
    h.store.dossiers.add({ topicId: ids[0]!, version: 1, dossier: { ...emptyDossier(), summary: 's' }, flags: [], inputHash: '', throughSeq: 0, model: 'm', createdAt: '2026-09-01T00:00:00.000Z' });
    const merge = { from: 'CI & tests', into: 'CI', reason: 'same area' };
    h.agent.answerConsolidation(() => ({ areaMerges: [merge] })).answerConsolidation(() => ({ areaMerges: [merge] }));

    await h.engine.consolidate();
    await h.engine.consolidate();

    expect(h.agent.consolidationInputs[0]?.areas.map((area) => area.name).sort()).toEqual(['CI', 'CI & tests']);
    const pending = (await h.engine.listProposals()).topics.filter((proposal) => proposal.kind === 'area_merge');
    expect(pending).toHaveLength(1);
    await h.engine.decideTopicProposal(pending[0]!.id, true);
    expect(h.store.topics.get(ids[1]!)?.area).toBe('CI');
  });
});
