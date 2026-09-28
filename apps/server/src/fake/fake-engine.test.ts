import { describe, expect, it } from 'vitest';
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

  it('refuses undo after the 6s window', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const marked = await engine.markRead('pr:PostHog/example-infra#41915');
    now = new Date(now.getTime() + 7000);
    const undone = await engine.undo(marked.undoToken);
    expect(undone).toEqual({ ok: false, message: 'undo window closed', undoToken: null });
  });

  it('undoes the newest batch when no token is given', async () => {
    const engine = new FakeEngine();
    await engine.setGitHubWrites(true);
    await engine.markRead('pr:PostHog/example-infra#41915');
    await engine.markRead('pr:PostHog/posthog#41790');
    await engine.undo(null);
    const topics = await engine.listTopics();
    expect(topics.find((item) => item.topic.id === 'topic-ci-tests')?.unreadTiles).toBe(2);
    expect(topics.find((item) => item.topic.id === 'topic-depot')?.unreadTiles).toBe(2);
  });

  it('wakes a time snooze once the time has passed', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const tileId = 'pr:PostHog/posthog#41822';
    await engine.setGitHubWrites(true);
    await engine.markRead(tileId);
    await engine.snooze(tileId, { kind: 'until_time', until: '2026-09-27T11:00:00.000Z' });
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('snoozed');
    now = new Date('2026-09-27T12:00:00Z');
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('done');
  });
});

describe('FakeEngine tile faces', () => {
  it('counts live "your move" tiles per topic in the topic list', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const expected = depot.filter((view) => view.state.kind !== 'done' && view.turn.kind === 'you').length;
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-depot');
    expect(expected).toBeGreaterThan(0);
    expect(item?.yourMoveTiles).toBe(expected);
  });

  it('shows all three turn kinds with the core rules', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const stack = depot.find((view) => view.tile.id.startsWith('stack:'));
    expect(stack?.turn).toMatchObject({ kind: 'you', what: 'Re-check 2 commits on #41911' });
    expect(stack?.prs.map((pr) => pr.why)).toEqual(['ST', 'ST', 'RV', 'RV']);
    expect(depot.find((view) => view.tile.id === 'pr:PostHog/posthog#41899')?.turn).toMatchObject({ kind: 'them', who: 'rowan', what: 'to merge' });
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
    const prKey = 'PostHog/posthog#41902';
    const facts = (await engine.getPr(prKey))?.facts ?? [];
    expect(facts.some((view) => view.stale === 'head_moved')).toBe(true);

    await engine.correctMemory({ kind: 'wrong', factId: 'fact-lyra-reviews-41902', topicId: null, text: '' });
    await engine.correctMemory({ kind: 'forget', factId: null, topicId: 'topic-depot', text: 'Storybook build time' });

    const after = (await engine.getPr(prKey))?.facts ?? [];
    expect(after.map((view) => view.fact.id)).not.toContain('fact-lyra-reviews-41902');
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
    expect(placements.get('topic-ingestion-runners')).toMatchObject({ relation: 'routed', ownerTeam: 'PostHog/team-ingestion' });
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
    const key = 'PostHog/posthog#41902';
    const before = (await engine.getPr(key))?.facts.map((view) => view.fact.text) ?? [];
    const fixed = await engine.correctMemory({ kind: 'fix', factId: 'fact-lyra-reviews-41902', topicId: null, text: '', fixedText: 'lyra and nell review #41902.' });
    expect((await engine.getPr(key))?.facts.map((view) => view.fact.text)).toContain('lyra and nell review #41902.');
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
    expect(log.at(-1)).toMatchObject({ action: 'writes_on', origin: 'footer' });
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
    expect((await tileOf())?.state.kind).toBe('done');
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

describe('FakeEngine queues', () => {
  it('fills every queue section and puts some topics in several', async () => {
    const topics = await new FakeEngine().listTopics();
    const tiers = ['needs_reply', 'mine', 'team', 'to_review', 'team_mentioned'] as const;
    for (const tier of tiers) {
      expect(topics.some((item) => item.queues.tiers[tier] > 0)).toBe(true);
    }
    const depot = topics.find((item) => item.topic.id === 'topic-depot');
    expect(tiers.filter((tier) => (depot?.queues.tiers[tier] ?? 0) > 0)).toEqual(['needs_reply', 'team', 'to_review']);
    expect(depot?.people.slice(0, 3).map((person) => person.relation)).toEqual(['team', 'team', 'team']);
    expect(await new FakeEngine().getViewer()).toEqual({ login: 'you', teamMembers: ['lyra', 'nell', 'rowan', 'sol'] });
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
    const approved = migrations.find((view) => view.tile.id === 'pr:PostHog/posthog#41808');
    expect(approved?.turn).toMatchObject({ kind: 'you', what: 'Merge, it is approved' });
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-migrations');
    expect(item?.yourMoveTiles).toBe(migrations.filter((view) => view.state.kind !== 'done' && view.turn.kind === 'you').length);
  });

  it('keeps pulled-in stack layers out of the queues', async () => {
    const engine = new FakeEngine();
    const depot = (await engine.getTopic('topic-depot'))?.tiles ?? [];
    const stack = depot.find((view) => view.tile.id.startsWith('stack:'));
    const layers = stack?.prs.filter((pr) => pr.provenance.kind === 'pulled_in') ?? [];
    expect(layers.map((pr) => pr.tier)).toEqual(['rest', 'rest']);
    const item = (await engine.listTopics()).find((entry) => entry.topic.id === 'topic-depot');
    // rowan's two open layers would add 2 to team and byTeam; only pinged PRs count.
    expect(item?.queues.tiers.team).toBe(2);
    expect(item?.queues.byTeam).toBe(3);
  });

  it('gives tiles and PRs their tier', async () => {
    const depot = (await new FakeEngine().getTopic('topic-depot'))?.tiles ?? [];
    const set = depot.find((view) => view.tile.id === 'set:turbo-cache');
    expect(set?.prs.map((pr) => pr.tier)).toEqual(['needs_reply', 'to_review', 'rest']);
    expect(set?.tier).toBe('needs_reply');
    expect(set?.prs[0]?.authorRelation).toBe('team');
  });
});

describe('FakeEngine found PRs', () => {
  it('shows found PRs calm, with their turn and a why code', async () => {
    const engine = new FakeEngine();
    const detail = await engine.getTopic('topic-ci-tests');
    const byKey = new Map(detail!.tiles.map((view) => [view.prs[0]!.key, view]));
    const review = byKey.get('PostHog/posthog#41955');
    expect(review).toMatchObject({ state: { kind: 'open' }, why: 'RV', turn: { kind: 'you' } });
    expect(review?.prs[0]?.provenance).toEqual({ kind: 'found', via: 'review_requested', reason: 'review requested from you' });
    expect(byKey.get('PostHog/posthog#41950')?.why).toBe('AU');
  });
});
