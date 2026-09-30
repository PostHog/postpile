// Stored loudness follows team roles (DESIGN.md "Team roles"): a role
// change derives the stored events again, without a GitHub fetch.
import { makeComment, makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';

const PLATFORM = 'acme/team-platform';
const APPROVERS = 'acme/client-approvers';

/** A PR by ada that @-mentions the approvers team. */
const pr = makePr({ number: 7, author: 'ada', comments: [makeComment({ id: 'c1', author: 'ada', body: '@acme/client-approvers can you look?' })] });

/** `count` reviewed PRs where only `requested` was asked. */
function reviewed(count: number, requested: string[], start = 0) {
  return Array.from({ length: count }, (_, index) => ({ key: `acme/app#${start + index}`, requested }));
}

function harness() {
  let now = new Date('2026-09-28T08:00:00Z');
  const h = makeHarness({ now: () => now });
  h.reader.addPr(pr, makeThreadFor(pr));
  h.reader.who = { login: viewer.login, teams: [PLATFORM, APPROVERS] };
  h.reader.teams.set(PLATFORM, ['lyra', viewer.login]);
  h.reader.teams.set(APPROVERS, ['ada', 'mira', viewer.login]);
  // Most reviews came through team-platform: approvers is a routing team.
  h.reader.reviewed = [...reviewed(60, [PLATFORM]), ...reviewed(40, [viewer.login], 100)];
  return { h, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600_000)) };
}

function mention(h: Harness) {
  return h.store.events.listForPr(pr.key).find((event) => event.kind === 'team_mention');
}

describe('stored events after a team role change', () => {
  it('turns a stored loud team mention quiet on a flip to routing, and loud again on the flip back', async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setTeamRole(APPROVERS, 'home');
    expect(mention(h)).toMatchObject({ ruleLoudness: 'loud', seenAt: null });
    const fetches = h.reader.fetchedRefs.length;

    await h.engine.setTeamRole(APPROVERS, 'routing');
    expect(mention(h)).toMatchObject({ ruleLoudness: 'quiet', ruleReason: 'mentions a team that only routes reviews to you', seenAt: null });

    await h.engine.setTeamRole(APPROVERS, 'home');
    expect(mention(h)).toMatchObject({ ruleLoudness: 'loud', seenAt: null });
    expect(h.reader.fetchedRefs).toHaveLength(fetches);
  });

  it('follows the first classification that changes a role, without fetching the PR again', async () => {
    const { h, advance } = harness();
    h.reader.teamRolesError = new Error('search timed out');
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(mention(h)).toMatchObject({ ruleLoudness: 'loud' });
    const fetched = h.reader.fetchedRefs.flat().length;

    h.reader.teamRolesError = null;
    advance(3);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.fetchedRefs.flat()).toHaveLength(fetched);
    expect(mention(h)).toMatchObject({ ruleLoudness: 'quiet' });
  });

  it('keeps a user override and the seen state', async () => {
    const { h } = harness();
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setTeamRole(APPROVERS, 'home');
    const id = mention(h)!.id;
    h.store.events.setOverride(id, { loudness: 'loud', reason: 'always tell me', by: 'user' });
    h.store.events.markSeen([id], '2026-09-28T09:00:00.000Z');

    await h.engine.setTeamRole(APPROVERS, 'routing');
    expect(mention(h)).toMatchObject({
      ruleLoudness: 'quiet',
      override: { loudness: 'loud', reason: 'always tell me', by: 'user' },
      seenAt: '2026-09-28T09:00:00.000Z',
    });
  });
});
