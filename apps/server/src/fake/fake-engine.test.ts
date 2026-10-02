import { describe, expect, it, vi } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

describe('FakeEngine', () => {
  it('shows a sample work context linked to sample topics, with Forget, Undo and Refresh', async () => {
    const engine = new FakeEngine({ sweepDelayMs: 0 });
    const view = await engine.getWorkContext();
    const threads = view.current?.threads ?? [];
    expect(threads.length).toBeGreaterThan(2);
    expect(threads[0]?.topics.map((topic) => topic.name)).toContain('Move CI to Depot');

    const forgotten = await engine.forgetWorkThread({ version: view.current!.version, index: 1 });
    expect((await engine.getWorkContext()).current?.threads[1]?.forgotten).toBe(true);
    await engine.undo(forgotten.undoToken);
    expect((await engine.getWorkContext()).current?.threads[1]?.forgotten).toBe(false);

    expect(await engine.sweepWorkContext()).toMatchObject({ ok: true, version: view.current!.version + 1 });
  });

  it('finds a new sample question every ~45s and pings for it', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    expect(await engine.pollOnce()).toMatchObject({ kind: 'done', notModified: true, pings: [] });

    now = new Date(now.getTime() + 45_000);
    const cycle = await engine.pollOnce();

    if (cycle.kind !== 'done') throw new Error('expected a done cycle');
    expect(cycle.notModified).toBe(false);
    expect(cycle.decisions).toMatchObject([{ ping: true, source: 'rules' }]);
    const target = cycle.pings[0]!.target;
    expect(cycle.pings[0]!.title).toMatch(/asked you something/);
    const topic = await engine.getTopic(target.topicId!);
    const tile = topic?.tiles.find((view) => view.tile.id === target.tileId);
    expect(tile?.state.kind).toBe('unread');
    expect(tile?.state.unreadBecause.some((reason) => reason.kind === 'question_to_user')).toBe(true);
    expect(await engine.pollOnce()).toMatchObject({ notModified: true });
  });

  it('reports the live poll as off until it is started', async () => {
    const engine = new FakeEngine();
    expect((await engine.livePollStatus()).state).toBe('off');
    engine.startLivePoll({ intervalSeconds: 10, onNotify: () => {}, log: () => {} });
    expect((await engine.livePollStatus()).state).toBe('waiting');
    await engine.close();
    expect((await engine.livePollStatus()).state).toBe('off');
  });

  it('simulates a low GitHub quota with POSTPILE_FAKE_QUOTA, and stays quiet without it', async () => {
    const now = new Date('2026-09-27T10:00:00Z');
    expect((await new FakeEngine({ now: () => now }).livePollStatus()).githubQuota).toBeNull();
    const low = new FakeEngine({ now: () => now, quota: 'low' });
    expect((await low.livePollStatus()).githubQuota).toMatchObject({ level: 'low', resource: 'graphql', resumeAt: '2026-09-27T10:35:00.000Z' });
    const critical = new FakeEngine({ now: () => now, quota: 'critical' });
    expect((await critical.livePollStatus()).githubQuota).toMatchObject({ level: 'critical', pollSeconds: null });
  });

  it('refuses undo after the 6s window', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const marked = await engine.markRead('pr:acme/infra#1915');
    now = new Date(now.getTime() + 7000);
    const undone = await engine.undo(marked.undoToken);
    expect(undone).toEqual({ ok: false, message: 'undo window closed', undoToken: null });
  });

  it('undoes the newest batch when no token is given', async () => {
    const engine = new FakeEngine();
    await engine.setGitHubWrites(true);
    await engine.markRead('pr:acme/infra#1915');
    await engine.markRead('pr:acme/app#1790');
    await engine.undo(null);
    const topics = await engine.listTopics();
    // #1790 merged without your review: quiet, but its thread is unread on GitHub again, so an unread tile without loud news.
    expect(topics.find((item) => item.topic.id === 'topic-ci-tests')).toMatchObject({ unreadTiles: 2, urgentUnreadTiles: 1, unseenMergeTiles: 0 });
    expect(topics.find((item) => item.topic.id === 'topic-depot')?.unreadTiles).toBe(2);
  });

  it('wakes a time snooze once the time has passed', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const tileId = 'pr:acme/app#1822';
    await engine.setGitHubWrites(true);
    await engine.markRead(tileId);
    await engine.snooze(tileId, { kind: 'until_time', until: '2026-09-27T11:00:00.000Z' });
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('snoozed');
    now = new Date('2026-09-27T12:00:00Z');
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('done');
  });
});

describe('FakeEngine tile faces', () => {
  it('lists the moves of live "your move" tiles per topic in the topic list', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const expected = depot.filter((view) => view.state.kind !== 'done' && view.turn.kind === 'you').map((view) => view.turn.what);
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-depot');
    expect(expected.length).toBeGreaterThan(0);
    expect(item?.yourMoves.map((move) => move.text).toSorted()).toEqual(expected.toSorted());
  });

  it('names the most urgent move first', async () => {
    const topics = await new FakeEngine().listTopics();
    const devEnv = topics.find((entry) => entry.topic.id === 'topic-dev-env');
    expect(devEnv?.yourMoves).toEqual([
      { move: 're_review', text: 'pim addressed your changes: re-review' },
      { move: 'review', text: "Review for team-platform: sol's PR" },
      // A bot opened #1972 for rowan: the team request names its owner, not the bot.
      { move: 'review', text: "Review for team-platform: rowan's PR" },
    ]);
  });

  it('files a bot PR assigned to the viewer as their own, with the assignee next to the bot author', async () => {
    const migrations = (await new FakeEngine().getTopic('topic-migrations'))?.tiles ?? [];
    const agent = migrations.find((view) => view.tile.id === 'pr:acme/app#1970');
    expect(agent?.forWhom).toEqual({ kind: 'own' });
    expect(agent?.turn).toMatchObject({ kind: 'them', who: 'lyra', lead: 'Waiting on' });
    expect(agent?.prs[0]).toMatchObject({ author: 'acme-agent[bot]', assignees: ['you'], authorRelation: 'you', tier: 'mine' });
  });

  it('shows all three turn kinds with the core rules', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const stack = depot.find((view) => view.tile.id.startsWith('stack:'));
    // #1911 was approved before the pushes; approvals stand on any commit, so the move is on #1902.
    expect(stack?.turn).toMatchObject({ kind: 'you', what: 'Review, lyra mentioned you on #1902' });
    expect(stack?.prs.map((pr) => pr.why)).toEqual(['ST', 'ST', 'RV', 'RV', 'ST']);
    expect(stack?.prs.map((pr) => pr.status.lifecycle)).toEqual(['merged', 'merged', 'open', 'open', 'closed']);
    expect(depot.find((view) => view.tile.id === 'pr:acme/app#1899')?.turn).toMatchObject({ kind: 'them', who: null, what: 'Waiting on the merge queue' });
    const desktop = (await engine.getTopic('topic-desktop-release'))?.tiles[0];
    expect(desktop).toMatchObject({ why: 'FW', turn: { kind: 'none' } });
  });
});

describe('FakeEngine memory', () => {
  it('shows the Depot dossier with changes since the seen cursor, until the topic is marked seen', async () => {
    const engine = new FakeEngine();
    const before = (await engine.getTopic('topic-depot'))?.dossier;
    expect(before?.version).toBe(3);
    expect(before?.history.map((note) => note.version)).toEqual([3, 2, 1]);
    expect(before?.changesSinceSeen?.changes.length).toBeGreaterThan(0);

    await engine.markTopicSeen('topic-depot');

    expect((await engine.getTopic('topic-depot'))?.dossier?.changesSinceSeen?.changes).toEqual([]);
  });

  it('forgets a fact marked wrong and remembers a dossier line marked wrong', async () => {
    const engine = new FakeEngine();
    const prKey = 'acme/app#1902';
    const facts = (await engine.getPr(prKey))?.facts ?? [];
    expect(facts.some((view) => view.stale === 'head_moved')).toBe(true);

    await engine.correctMemory({ kind: 'wrong', factId: 'fact-lyra-reviews-1902', topicId: null, text: '' });
    await engine.correctMemory({ kind: 'forget', factId: null, topicId: 'topic-depot', text: 'Storybook build time' });

    const after = (await engine.getPr(prKey))?.facts ?? [];
    expect(after.map((view) => view.fact.id)).not.toContain('fact-lyra-reviews-1902');
    expect((await engine.getTopic('topic-depot'))?.dossier?.correctedClaims).toContain('Storybook build time');
  });

  it('has rich sources for the Depot dossier', async () => {
    const engine = new FakeEngine();
    const line = (path: string) => engine.getMemorySources({ kind: 'dossier_line', topicId: 'topic-depot', version: 3, path });

    const question = await line('openQuestions[0]');
    expect(question?.sources.map((source) => [source.kind, source.who, source.missing])).toEqual([
      ['comment', 'lyra', false],
      ['event', 'lyra', false],
    ]);
    expect(question?.check.state).toBe('ok');
    expect((await line('status'))?.check).toMatchObject({ state: 'stale', reason: 'head_moved' });
    expect((await line('openQuestions[2]'))?.check).toMatchObject({ state: 'stale', reason: 'thread_resolved' });
    expect((await line('userCares[0]'))?.check.state).toBe('user_only');
    expect((await line('userCares[3]'))?.sources.map((source) => source.kind)).toEqual(['comment', 'chat']);
    expect((await line('timeline[3]'))?.check.state).toBe('unsourced');
    expect((await engine.getMemorySources({ kind: 'fact', factId: 'fact-lyra-owns-workflows' }))?.sources.every((source) => !source.missing)).toBe(true);
  });

  it('places sample topics in every group, and a relation correction moves one', async () => {
    const engine = new FakeEngine();
    const placements = new Map((await engine.listTopics()).map((item) => [item.topic.id, item.placement]));
    expect(placements.get('topic-depot')).toMatchObject({ relation: 'team', area: 'CI' });
    expect(placements.get('topic-ingestion-runners')).toMatchObject({ relation: 'routed', ownerTeam: 'acme/team-ingestion' });
    expect(placements.get('topic-desktop-release')).toMatchObject({ relation: 'fyi', area: 'Desktop' });

    await engine.correctMemory({ kind: 'wrong', factId: null, topicId: 'topic-desktop-release', text: 'FYI', relation: 'routed' });

    expect((await engine.getTopic('topic-desktop-release'))?.placement).toMatchObject({ relation: 'routed', corrected: true });
  });

  it('files the next rule proposal once and merges a topic on accept', async () => {
    const engine = new FakeEngine();
    expect((await engine.consolidate()).ruleProposalsFiled).toBe(1);
    expect((await engine.consolidate()).ruleProposalsFiled).toBe(0);
    expect((await engine.listProposals()).rules).toHaveLength(2);

    await engine.decideTopicProposal('proposal-merge-frontend', true);

    const topics = await engine.listTopics();
    expect(topics.map((item) => item.topic.id)).not.toContain('topic-frontend-build');
  });

  it('refreshes sample PRs for an outside agent under the real rules', async () => {
    const engine = new FakeEngine();
    const agent = { source: 'agent', client: 'claude-code' } as const;
    const first = await engine.refreshNow({ kind: 'pr', prKey: 'acme/app#1902' }, agent);
    expect(first).toMatchObject({ status: 'done', fetched: ['acme/app#1902'], changed: [] });
    const again = await engine.refreshNow({ kind: 'pr', prKey: 'acme/app#1902' }, agent);
    expect(again).toMatchObject({ status: 'done', fetched: [], fresh: [{ prKey: 'acme/app#1902' }] });
    const topic = await engine.refreshNow({ kind: 'topic', topicId: 'topic-depot' }, agent);
    expect(topic.prKeys.length).toBeGreaterThan(1);
    expect(topic.fresh.map((entry) => entry.prKey)).toEqual(['acme/app#1902']);
    expect((await engine.actionLog(1))[0]).toMatchObject({ action: 'agent_refresh', origin: 'agent' });
  });

  it('files an outside topic suggestion in memory with a stack-aware preview', async () => {
    const engine = new FakeEngine();
    const change = { topicId: 'topic-depot', kind: 'split' as const, prKeys: ['acme/app#1902'], name: 'Depot stack', intoTopicId: null, reason: 'one stack', dryRun: true };
    const dry = await engine.proposeTopicChange(change, { client: 'claude-code' });
    expect(dry.status).toBe('dry_run');
    expect(dry.preview.join('\n')).toContain('acme/app#1902 brings acme/app#1851, acme/app#1862, acme/app#1911 and acme/app#1930 along (same stack).');

    const filed = await engine.proposeTopicChange({ ...change, dryRun: false }, { client: 'claude-code' });
    expect(filed.status).toBe('filed');
    expect((await engine.listProposals()).topics.find((proposal) => proposal.id === filed.proposalId)).toMatchObject({ source: 'agent', client: 'claude-code' });
    expect((await engine.getTopic('topic-depot'))?.pendingProposals.map((proposal) => proposal.id)).toContain(filed.proposalId);
  });

  it('shows who suggested a topic change and splits the topic on accept', async () => {
    const engine = new FakeEngine();
    const split = (await engine.listProposals()).topics.find((proposal) => proposal.id === 'proposal-split-sharding');
    expect(split).toMatchObject({ kind: 'split', source: 'agent', client: 'claude-code' });

    expect((await engine.decideTopicProposal('proposal-split-sharding', true)).ok).toBe(true);

    const moved = (await engine.getPr('acme/app#1822'))?.topicId;
    expect(moved).not.toBe('topic-ci-tests');
    expect((await engine.getTopic(moved ?? ''))?.topic.name).toBe('Backend test sharding');
    expect((await engine.getPr('acme/app#1955'))?.topicId).toBe('topic-ci-tests');
    expect((await engine.getTopic('topic-ci-tests'))?.decidedProposals.map((proposal) => proposal.id)).toEqual(['proposal-split-sharding']);
  });
});

describe('FakeEngine rechecks', () => {
  it('cycles holds, fix and drop so every dialog state can be seen', async () => {
    const engine = new FakeEngine({ recheckDelayMs: 0 });
    const request = { factId: null, topicId: 'topic-depot', text: 'rowan drives it.', target: null };
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await engine.recheckMemory(request);
      outcomes.push(result.status === 'answered' ? result.outcome : result.status);
    }
    expect(outcomes).toEqual(['holds', 'fix', 'drop', 'holds']);
  });

  it('replaces a fact on an accepted fix and undoes it', async () => {
    const engine = new FakeEngine();
    const key = 'acme/app#1902';
    const before = (await engine.getPr(key))?.facts.map((view) => view.fact.text) ?? [];
    const fixed = await engine.correctMemory({ kind: 'fix', factId: 'fact-lyra-reviews-1902', topicId: null, text: '', fixedText: 'lyra and nell review #1902.' });
    expect((await engine.getPr(key))?.facts.map((view) => view.fact.text)).toContain('lyra and nell review #1902.');
    await engine.undo(fixed.undoToken);
    expect((await engine.getPr(key))?.facts.map((view) => view.fact.text).sort()).toEqual([...before].sort());
  });

  it('flips the writes lock and fills the action log with fake queue sends', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    expect(await engine.githubWrites()).toEqual({ enabled: false, forcedOffReason: null, pending: [] });
    await engine.setGitHubWrites(true);

    const marked = await engine.markRead('set:turbo-cache');
    expect(marked.message).not.toMatch(/here only/);
    now = new Date(now.getTime() + 7000);

    const rows = await engine.debugNotifications(100);
    const sent = rows.filter((row) => row.lastAction?.origin === 'queue');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((row) => !row.thread.unread && row.lastAction?.outcome === 'github' && row.decidedBy?.origin === 'tile')).toBe(true);
    const log = await engine.actionLog(50);
    // The oldest entry after the sample "Handled quietly" rows.
    expect(log.filter((entry) => entry.origin !== 'quiet').at(-1)).toMatchObject({ action: 'writes_on', origin: 'footer' });
  });

  it('turns a locked mark-read into a pending write: the tile stays unread until it is sent', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const tileOf = async () => (await engine.getTopic('topic-depot'))?.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    const before = await engine.debugNotifications(100);
    const unread = before.filter((row) => row.thread.unread && row.landing.kind === 'tile' && row.landing.tileId === 'set:turbo-cache');
    expect(unread.length).toBeGreaterThan(0);

    const marked = await engine.markRead('set:turbo-cache');
    expect(marked.message).toMatch(/pending until you unlock/);
    now = new Date(now.getTime() + 7000);

    expect((await tileOf())?.state.kind).toBe('unread');
    expect((await tileOf())?.pendingWrite).not.toBeNull();
    expect((await engine.githubWrites()).pending).toEqual([expect.objectContaining({ tileId: 'set:turbo-cache', threadCount: unread.length })]);
    const after = await engine.debugNotifications(100);
    for (const row of unread) {
      const again = after.find((candidate) => candidate.thread.id === row.thread.id);
      expect(again?.thread.unread).toBe(true);
      expect(again?.lastAction).toMatchObject({ action: 'mark_read', outcome: 'pending' });
    }

    expect((await engine.sendPendingWrites()).ok).toBe(false);
    await engine.setGitHubWrites(true);
    const sent = await engine.sendPendingWrites();
    expect(sent).toMatchObject({ ok: true, done: 1 });
    expect(sent.status.pending).toEqual([]);
    // Read, but reviews are still asked of you there: it stays open, not done.
    expect((await tileOf())?.state.kind).toBe('open');
    const sentRows = await engine.debugNotifications(100);
    expect(unread.every((row) => sentRows.find((candidate) => candidate.thread.id === row.thread.id)?.thread.unread === false)).toBe(true);
  });

  it('discards pending writes and leaves the tile unread', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    await engine.markRead('set:turbo-cache');
    now = new Date(now.getTime() + 7000);

    const discarded = await engine.discardPendingWrites();

    expect(discarded.status.pending).toEqual([]);
    const view = (await engine.getTopic('topic-depot'))?.tiles.find((candidate) => candidate.tile.id === 'set:turbo-cache');
    expect(view?.state.kind).toBe('unread');
    expect(view?.pendingWrite).toBeNull();
    expect((await engine.actionLog(1))[0]).toMatchObject({ outcome: 'discarded', origin: 'footer' });
  });
});

describe('FakeEngine markPrRead', () => {
  it('marks one PR of a set, handled, with an undo for that PR only', async () => {
    const engine = new FakeEngine();
    await engine.setGitHubWrites(true);
    const setOf = async () => (await engine.getTopic('topic-depot'))?.tiles.find((view) => view.tile.id === 'set:turbo-cache');
    const before = await setOf();
    const target = before?.prs.find((pr) => pr.provenance.kind !== 'pulled_in' && !pr.done);
    expect(target).toBeDefined();
    const othersBefore = before?.prs.filter((pr) => pr.key !== target!.key).map((pr) => [pr.key, pr.done, pr.unseenLoudEvents]);

    const marked = await engine.markPrRead('set:turbo-cache', target!.key);

    expect(marked.ok).toBe(true);
    const after = await setOf();
    expect(after?.prs.find((pr) => pr.key === target!.key)?.unseenLoudEvents).toBe(0);
    expect(after?.prs.filter((pr) => pr.key !== target!.key).map((pr) => [pr.key, pr.done, pr.unseenLoudEvents])).toEqual(othersBefore);
    expect((await engine.undo(marked.undoToken)).ok).toBe(true);
    expect((await setOf())?.prs.find((pr) => pr.key === target!.key)?.unseenLoudEvents).toBe(target!.unseenLoudEvents);
  });

  it('marks a pulled-in stack layer read without touching the tracked layers, and refuses PRs outside the tile', async () => {
    const engine = new FakeEngine();
    await engine.setGitHubWrites(true);
    const stackOf = async () => (await engine.getTopic('topic-depot'))?.tiles.find((view) => view.tile.id.startsWith('stack:'));
    const stack = await stackOf();
    const layer = stack?.prs.find((pr) => pr.provenance.kind === 'pulled_in');
    expect(layer).toBeDefined();
    const tracked = () => stackOf().then((view) => view?.prs.filter((pr) => pr.provenance.kind !== 'pulled_in').map((pr) => [pr.key, pr.done, pr.unseenLoudEvents]));
    const trackedBefore = await tracked();

    expect((await engine.markPrRead(stack!.tile.id, layer!.key)).ok).toBe(true);

    expect(await tracked()).toEqual(trackedBefore);
    expect((await engine.markPrRead(stack!.tile.id, 'acme/app#1')).ok).toBe(false);
  });
});

describe('FakeEngine removeTeamRequest', () => {
  async function teamRequested(engine: FakeEngine) {
    const topics = await engine.listTopics();
    const details = await Promise.all(topics.map((item) => engine.getTopic(item.topic.id)));
    return details.flatMap((detail) => detail?.tiles ?? []).flatMap((view) => view.prs.filter((pr) => pr.ownTeamRequests.length > 0).map((pr) => ({ view, pr })));
  }

  it('offers it on sample PRs with a pending team request, refuses while locked, then removes and logs both writes', async () => {
    const engine = new FakeEngine();
    const [found] = await teamRequested(engine);
    expect(found).toBeDefined();
    const team = found!.pr.ownTeamRequests[0]!;

    expect((await engine.removeTeamRequest(found!.pr.key, team)).ok).toBe(false);
    await engine.setGitHubWrites(true);
    const removed = await engine.removeTeamRequest(found!.pr.key, team);

    expect(removed).toMatchObject({ ok: true, undoToken: null });
    const log = (await engine.actionLog(10)).map((entry) => `${entry.action} ${entry.outcome}`);
    expect(log).toContain('remove_team_request github');
    expect(log).toContain('remove_team_request skipped');
    expect((await teamRequested(engine)).some((entry) => entry.pr.key === found!.pr.key)).toBe(false);
    expect((await engine.removeTeamRequest(found!.pr.key, team)).ok).toBe(false);
  });
});

describe('FakeEngine queues', () => {
  it('fills every queue section and gives some topics PRs in several tiers', async () => {
    const topics = await new FakeEngine().listTopics();
    const tiers = ['needs_reply', 'changes_requested', 'mine', 'team', 'to_review', 'team_mentioned'] as const;
    for (const tier of tiers) {
      expect(topics.some((item) => item.queues.tiers[tier] > 0)).toBe(true);
    }
    const depot = topics.find((item) => item.topic.id === 'topic-depot');
    expect(tiers.filter((tier) => (depot?.queues.tiers[tier] ?? 0) > 0)).toEqual(['needs_reply', 'team', 'to_review']);
    expect(depot?.people.map((person) => person.relation)).toEqual(['team', 'team', 'other']);
    // The viewer drives runner images and a teammate's PR sits next to theirs: My PRs, not Team's PRs.
    const runners = topics.find((item) => item.topic.id === 'topic-runner-images');
    expect(runners?.queues.tiers).toMatchObject({ mine: 2, team: 1 });
    expect(runners?.section).toBe('mine');
    expect(await new FakeEngine().getViewer()).toEqual({ login: 'you', teamMembers: ['lyra', 'nell', 'rowan', 'sol'], homeTeams: ['acme/team-platform'] });
  });

  it('keeps a topic whose only unread tile is merged calm and ranks it below the urgent ones', async () => {
    const topics = await new FakeEngine().listTopics();
    const frontend = topics.find((item) => item.topic.id === 'topic-frontend-build');
    expect(frontend).toMatchObject({ group: 'quiet', unreadTiles: 1, urgentUnreadTiles: 0 });
    const lastUrgent = topics.findLastIndex((item) => item.group === 'needs_you');
    expect(topics.indexOf(frontend!)).toBeGreaterThan(lastUrgent);
  });

  it('counts merging your approved PR as a move without making the topic urgent', async () => {
    const engine = new FakeEngine();
    const migrations = (await engine.getTopic('topic-migrations'))?.tiles ?? [];
    const approved = migrations.find((view) => view.tile.id === 'pr:acme/app#1808');
    expect(approved?.turn).toMatchObject({ kind: 'you', what: 'Merge, it is approved' });
    // An agent's approval counts like any other; the pill only names who gave it.
    expect(approved?.prs[0]?.status).toMatchObject({ review: 'approved', agentApprovers: ['reviewbot'] });
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-migrations');
    expect(item?.yourMoves.length).toBe(migrations.filter((view) => view.state.kind !== 'done' && view.turn.kind === 'you').length);
  });

  it('shows the merge queue samples: every step, a failure, and a PR merged through it', async () => {
    const engine = new FakeEngine();
    const runners = await engine.getTopic('topic-runner-images');
    const rows = new Map((runners?.tiles ?? []).flatMap((view) => view.prs).map((row) => [row.key, row.status]));
    expect(rows.get('acme/app#1977')).toMatchObject({ icon: 'merge_queue', mergeQueue: { state: 'submitted' } });
    expect(rows.get('acme/app#1978')).toMatchObject({ icon: 'merge_queue', mergeQueue: { state: 'waiting' } });
    expect(rows.get('acme/app#1974')).toMatchObject({ icon: 'merged', mergeQueue: null });
    const testing = runners?.tiles.find((view) => view.tile.id === 'pr:acme/app#1975');
    expect(testing?.prs[0]?.status).toMatchObject({ icon: 'merge_queue', mergeQueue: { state: 'testing', testingOn: 'acme/app#1976' } });
    expect(testing?.turn).toMatchObject({ kind: 'them', who: null, what: 'Waiting on the merge queue' });
    const rowans = runners?.tiles.find((view) => view.tile.id === 'pr:acme/app#1978');
    expect(rowans?.turn).toMatchObject({ kind: 'them', who: null, what: 'Waiting on the merge queue' });
    expect(runners?.prRollup.state).toBe('merge_queue');
    const ci = await engine.getTopic('topic-ci-tests');
    const failed = ci?.tiles.find((view) => view.tile.id === 'pr:acme/app#1950');
    expect(failed?.prs[0]?.status).toMatchObject({ icon: 'merge_queue_failed', mergeQueue: { state: 'failed', reason: 'waited too long to become mergeable' } });
    expect(failed?.turn).toMatchObject({ kind: 'you', what: 'Re-submit to the merge queue: waited too long to become mergeable' });
    expect(ci?.prRollup.state).toBe('merge_queue_failed');
    expect((await engine.getPr('acme/app#1950'))?.status.icon).toBe('merge_queue_failed');
  });

  it('keeps pulled-in stack layers out of the queues', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const stack = depot.find((view) => view.tile.id.startsWith('stack:'));
    const layers = stack?.prs.filter((pr) => pr.provenance.kind === 'pulled_in') ?? [];
    expect(layers.map((pr) => pr.tier)).toEqual(['rest', 'rest', 'rest']);
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-depot');
    // rowan's two pulled-in layers would add 2 to team and byTeam; only pinged PRs count.
    // lyra's #1904 and #1907 in the set count for byTeam; their tier is a review or a reply.
    expect(item?.queues.tiers.team).toBe(2);
    expect(item?.queues.byTeam).toBe(5);
  });

  it('gives tiles and PRs their tier', async () => {
    const depot = (await new FakeEngine().getTopic('topic-depot'))?.tiles ?? [];
    const set = depot.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.prs.map((pr) => pr.tier)).toEqual(['to_review', 'needs_reply', 'to_review', 'rest']);
    expect(set?.tier).toBe('needs_reply');
    expect(set?.prs[0]?.authorRelation).toBe('team');
  });
});

describe('FakeEngine addressed your changes', () => {
  it('lists a PR whose author pushed after your changes request under Changes you requested, for you', async () => {
    const devEnv = (await new FakeEngine().getTopic('topic-dev-env'))?.tiles ?? [];
    const view = devEnv.find((item) => item.tile.id === 'pr:acme/app#1960');
    expect(view?.turn).toMatchObject({ kind: 'you', what: 'pim addressed your changes: re-review' });
    expect(view?.prs[0]?.tier).toBe('changes_requested');
    expect(view?.forWhom).toEqual({ kind: 'you' });
  });

  it('lists a change request still waiting on the author there too, and counts only the addressed one', async () => {
    const engine = new FakeEngine();
    const frontend = (await engine.getTopic('topic-frontend-build'))?.tiles ?? [];
    const waiting = frontend.find((item) => item.tile.id === 'pr:acme/app#1963');
    expect(waiting?.turn).toMatchObject({ kind: 'them', who: 'tove' });
    expect(waiting?.prs[0]?.tier).toBe('changes_requested');
    const topics = await engine.listTopics();
    const queues = (id: string) => topics.find((item) => item.topic.id === id)?.queues;
    expect(queues('topic-dev-env')).toMatchObject({ tiers: { changes_requested: 1 }, changesAddressed: 1 });
    expect(queues('topic-frontend-build')).toMatchObject({ tiers: { changes_requested: 1 }, changesAddressed: 0 });
  });
});

describe('FakeEngine what is new on a revisit', () => {
  it('summarises the pushes since your changes request on #1960, bots and CI left out', async () => {
    const engine = new FakeEngine();
    const devEnv = (await engine.getTopic('topic-dev-env'))?.tiles ?? [];
    const view = devEnv.find((item) => item.tile.id === 'pr:acme/app#1960');
    expect(view?.prs[0]?.whatsNew).toMatchObject({ anchor: { kind: 'changes_request' }, lead: { kind: 'push', count: 3, actor: 'pim' }, extraCount: 0 });
    const detail = await engine.getPr('acme/app#1960');
    expect(detail?.whatsNew?.anchor.kind).toBe('changes_request');
    expect(detail?.activity.fresh.map((line) => line.summary)).toEqual(['pim pushed 3 commits']);
    expect(detail?.activity.freshNoiseLabel).toBe('2 bot comments, CI');
    expect(detail?.activity.earlier.map((line) => line.summary)).toEqual(['you requested changes']);
    expect(detail?.activity.noise).toEqual([]);
  });

  it('keeps a first-time ask plain', async () => {
    const detail = await new FakeEngine().getPr('acme/app#1801');
    expect(detail?.activity.fresh).toHaveLength(1);
    expect(detail?.whatsNew).toBeNull();
  });
});

describe('FakeEngine found PRs', () => {
  it('shows found PRs calm, with their turn and a why code', async () => {
    const engine = new FakeEngine();
    const detail = await engine.getTopic('topic-ci-tests');
    const byKey = new Map(detail!.tiles.map((view) => [view.prs[0]!.key, view]));
    const review = byKey.get('acme/app#1955');
    expect(review).toMatchObject({ state: { kind: 'open' }, why: 'RV', turn: { kind: 'you' } });
    expect(review?.prs[0]?.provenance).toEqual({ kind: 'found', via: 'review_requested', reason: 'review requested from you' });
    expect(byKey.get('acme/app#1950')?.why).toBe('AU');
  });
});

describe('FakeEngine sync progress', () => {
  it('reports progress while the fake sync runs, the total growing, and null after', async () => {
    const engine = new FakeEngine({ syncStepMs: 20 });
    expect(await engine.syncProgress()).toBeNull();

    const syncing = engine.sync();
    expect(engine.sync()).toBe(syncing);
    // Each phase lasts one 20ms step; poll faster than waitFor's 50ms default so none is missed.
    await vi.waitFor(async () => expect((await engine.syncProgress())?.agentCallsPlanned).toBe(3), { interval: 2 });
    await vi.waitFor(async () => expect((await engine.syncProgress())?.agentCallsPlanned).toBe(4), { interval: 2 });
    const report = await syncing;

    expect(report.agentCalls).toBe(4);
    expect(await engine.syncProgress()).toBeNull();
  });
});

describe('FakeEngine drafts', () => {
  it('has a draft of yours with a draft pill and no move', async () => {
    const engine = new FakeEngine();
    const topics = await engine.listTopics();
    const views = (await Promise.all(topics.map((item) => engine.getTopic(item.topic.id)))).flatMap((detail) => detail?.tiles ?? []);
    const draft = views.flatMap((view) => view.prs.map((pr) => ({ view, pr }))).find(({ pr }) => pr.isDraft);
    expect(draft?.pr.status.lifecycle).toBe('draft');
    expect(draft?.pr.tier).not.toBe('to_review');
    expect(draft?.view.turn.kind).not.toBe('you');
  });
});
