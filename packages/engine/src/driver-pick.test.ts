import { emptyDossier, OUTSIDE_DRIVER, TEAM_DRIVER } from '@postpile/core';
import { at, makePr, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { FAKE_MODEL } from './testing/fake-agent.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { topicWithPrs } from './testing/topics.ts';

function harnessWithTeam() {
  const h = makeHarness();
  h.reader.teams.set('acme/team-platform', ['lyra']);
  return h;
}

async function sectionOf(h: Harness, topicId: string) {
  return (await h.engine.listTopics()).find((item) => item.topic.id === topicId)?.section;
}

describe('the driver picker', () => {
  it('moves the topic at once, keeps the pick through a sync, and resets to automatic', async () => {
    const h = harnessWithTeam();
    topicWithPrs(h, 'own', [makePr({ number: 30, author: viewer.login })]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(await sectionOf(h, 'own')).toBe('you_drive');

    expect((await h.engine.setTopicDriver('own', 'lyra')).ok).toBe(true);
    const picked = await h.engine.getTopic('own');
    expect(picked?.section).toBe('team_owns');
    expect(picked?.driver).toMatchObject({ kind: 'person', login: 'lyra', picked: true });
    // The automatic driver stays stored beside the pick; the role follows the pick.
    expect(picked?.topic.driver).toBe(viewer.login);
    expect(picked?.topic.userRole).not.toBe('driver');

    // A sync refreshes the automatic driver (refreshDriversAndRoles) and leaves the pick alone.
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(await sectionOf(h, 'own')).toBe('team_owns');
    expect(h.store.topics.get('own')?.driver).toBe(viewer.login);
    expect(h.store.topics.get('own')?.userRole).not.toBe('driver');

    await h.engine.setTopicDriver('own', OUTSIDE_DRIVER);
    expect(await sectionOf(h, 'own')).toBe('other_work');

    await h.engine.setTopicDriver('own', null);
    const reset = await h.engine.getTopic('own');
    expect(reset?.section).toBe('you_drive');
    expect(reset?.driver).toMatchObject({ kind: 'you', picked: false });
    expect(reset?.topic.userRole).toBe('driver');
    expect(h.telemetry.events.filter((entry) => entry.event === 'driver_set').map((entry) => entry.props)).toEqual([
      { kind: 'teammate' },
      { kind: 'outside' },
      { kind: 'automatic' },
    ]);
  });

  it('refuses a driver the menu does not offer', async () => {
    const h = harnessWithTeam();
    topicWithPrs(h, 'own', [makePr({ number: 31, author: viewer.login })]);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.setTopicDriver('own', 'stranger')).ok).toBe(false);
    expect((await h.engine.setTopicDriver('missing', TEAM_DRIVER)).ok).toBe(false);
    expect(h.store.driverPicks.all().size).toBe(0);
  });

  it("stores the team as the automatic driver when the dossier says the team drives", async () => {
    const h = harnessWithTeam();
    topicWithPrs(h, 'egress', [makePr({ number: 32, author: 'ada' })]);
    const dossier = { ...emptyDossier(), summary: 's', driverTeam: true, people: [{ login: 'ada', role: 'contributor' as const, note: '' }] };
    h.store.dossiers.add({ topicId: 'egress', version: 1, dossier, flags: [], inputHash: 'h', throughSeq: 0, model: FAKE_MODEL, createdAt: at(0) });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('egress')?.driver).toBe(TEAM_DRIVER);
    const detail = await h.engine.getTopic('egress');
    expect(detail?.section).toBe('team_owns');
    expect(detail?.driver).toMatchObject({ kind: 'team', login: null, picked: false });
  });

  it('keeps the relation on the automatic driver when the user picks themselves', async () => {
    const h = harnessWithTeam();
    const pr = makePr({ number: 33, author: 'rowan', reviewerTeams: ['acme/team-platform'], updatedAt: at(1) });
    topicWithPrs(h, 'routed', [pr]);
    const routed = () => ({ dossier: { ...emptyDossier(), summary: 's', relation: { kind: 'routed' as const, ownerTeam: null, whyYou: 'review requested' } } });
    h.agent.answerDossier(routed).answerDossier(routed);
    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.store.dossiers.latest('routed')?.dossier.relation?.kind).toBe('routed');
    const calls = h.agent.dossierInputs.length;

    await h.engine.setTopicDriver('routed', viewer.login);
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(h.agent.dossierInputs).toHaveLength(calls);
    expect(h.store.dossiers.latest('routed')?.dossier.relation?.kind).toBe('routed');
  });
});
