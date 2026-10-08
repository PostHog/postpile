import { makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { loadViewer } from './viewer-meta.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

describe('team members', () => {
  function harness() {
    let now = new Date('2026-09-28T08:00:00Z');
    const h = makeHarness({ now: () => now });
    h.reader.addPr(reviewRequestedPr(1), makeThreadFor(reviewRequestedPr(1)));
    h.reader.teams.set('acme/team-platform', ['lyra', viewer.login, 'rowan']);
    return { h, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600_000)) };
  }

  it('stores every other login on the viewer teams on the viewer', async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'rowan']);
  });

  it('refreshes at most daily, sending the stored ETag', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    advance(2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamCalls).toHaveLength(1);
    advance(23);
    h.reader.teams.set('acme/team-platform', ['lyra', viewer.login, 'rowan', 'nell']);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamCalls).toEqual([
      ['acme/team-platform', null],
      ['acme/team-platform', `team-etag:lyra,${viewer.login},rowan`],
    ]);
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'nell', 'rowan']);
  });

  it('keeps the last list when a refresh fails, and never fails the sync over it', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    advance(25);
    h.reader.teamError = new Error('network down');
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([]);
    expect(loadViewer(h.store)?.teamMembers).toEqual(['lyra', 'rowan']);
  });

  it('shows the cached members per home team, and says when they were never fetched', async () => {
    const { h } = harness();
    expect(await h.engine.getTeamMembers()).toEqual({ fetchedAt: null, teams: [] });
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(await h.engine.getTeamMembers()).toEqual({
      fetchedAt: '2026-09-28T08:00:00.000Z',
      teams: [{ team: 'acme/team-platform', members: ['lyra', viewer.login, 'rowan'] }],
    });
  });
});

describe('team roles during sync', () => {
  const APPROVERS = 'acme/client-approvers';

  /** `count` reviewed PRs where only `requested` was asked. */
  function reviewed(count: number, requested: string[], start = 0) {
    return Array.from({ length: count }, (_, index) => ({ key: `acme/app#${start + index}`, requested }));
  }

  function harness() {
    let now = new Date('2026-09-28T08:00:00Z');
    const h = makeHarness({ now: () => now });
    h.reader.addPr(reviewRequestedPr(1), makeThreadFor(reviewRequestedPr(1)));
    h.reader.who = { login: viewer.login, teams: ['acme/team-platform', APPROVERS] };
    h.reader.teams.set('acme/team-platform', ['lyra', viewer.login]);
    h.reader.teams.set(APPROVERS, ['ada', 'mira', viewer.login]);
    h.reader.reviewed = [...reviewed(40, ['acme/team-platform']), ...reviewed(3, [APPROVERS], 100), ...reviewed(57, [viewer.login], 200)];
    return { h, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600_000)) };
  }

  it('classifies an install without roles on the next sync, and fetches home team members only', async () => {
    const { h } = harness();
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([]);
    expect(loadViewer(h.store)).toMatchObject({ teams: ['acme/team-platform', APPROVERS], homeTeams: ['acme/team-platform'], teamMembers: ['lyra'] });
    expect(h.reader.teamCalls.map(([team]) => team)).toEqual(['acme/team-platform']);
    expect(await h.engine.getViewer()).toEqual({ login: viewer.login, teamMembers: ['lyra'], homeTeams: ['acme/team-platform'] });
  });

  it('reads the review history once, then only for a team the viewer joins', async () => {
    const { h, advance } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setTeamRole(APPROVERS, 'home');
    advance(2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.reviewedCalls).toHaveLength(1);

    h.reader.who = { login: viewer.login, teams: ['acme/team-platform', APPROVERS, 'acme/infra'] };
    h.reader.teamSizeCounts.set('acme/infra', 40);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.reviewedCalls).toHaveLength(2);
    const roles = await h.engine.getTeamRoles();
    expect(roles.teams.map((team) => [team.slug, team.role, team.source])).toEqual([
      ['team-platform', 'home', 'auto'],
      ['client-approvers', 'home', 'user'],
      ['infra', 'routing', 'auto'],
    ]);
    expect(loadViewer(h.store)?.teamMembers).toEqual(['ada', 'lyra', 'mira']);
  });

  it('keeps every team home when the classification fails, without failing the sync', async () => {
    const { h, advance } = harness();
    h.reader.teamRolesError = new Error('search timed out');
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([]);
    expect(loadViewer(h.store)?.homeTeams).toBeUndefined();
    expect(loadViewer(h.store)?.teamMembers).toEqual(['ada', 'lyra', 'mira']);

    h.reader.teamRolesError = null;
    advance(2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(loadViewer(h.store)?.homeTeams).toEqual(['acme/team-platform']);
  });

  it('waits two hours after a failed classification before a sync tries again', async () => {
    const { h, advance } = harness();
    h.reader.teamRolesError = new Error('search timed out');
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamSizeCalls).toBe(1);

    h.reader.teamRolesError = null;
    advance(1.9);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamSizeCalls).toBe(1);
    expect(loadViewer(h.store)?.homeTeams).toBeUndefined();

    advance(0.2);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamSizeCalls).toBe(2);
    expect(loadViewer(h.store)?.homeTeams).toEqual(['acme/team-platform']);
  });

  it('skips the classification while the GitHub quota is low, and classifies once it recovers', async () => {
    const { h, advance } = harness();
    const resetAtMs = h.timers.now() + 30 * 60 * 1000;
    h.quota.note({ resource: 'graphql', limit: 5000, remaining: 1000, resetAtMs });
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.teamSizeCalls).toBe(0);
    expect(loadViewer(h.store)?.homeTeams).toBeUndefined();

    advance(1);
    h.quota.note({ resource: 'graphql', limit: 5000, remaining: 4900, resetAtMs: h.timers.now() + 60 * 60 * 1000 });
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.reviewedCalls).toHaveLength(1);
    expect(loadViewer(h.store)?.homeTeams).toEqual(['acme/team-platform']);
  });
});
