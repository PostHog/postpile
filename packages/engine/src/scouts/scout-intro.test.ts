import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScoutCandidate } from '@postpile/core';
import { makePr } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, NOW, type Harness } from '../testing/fakes.ts';
import { UserConfigFile } from '../user-config.ts';

const PROMPT = 'PRs from other teams that add a new top-level folder or service.';

function candidate(number: number): ScoutCandidate {
  return {
    key: `acme/app#${number}`,
    nodeId: `PR_${number}`,
    title: `Add service ${number}`,
    body: '',
    author: 'carol',
    assignees: [],
    isDraft: false,
    state: 'OPEN',
    headOid: `h${number}`,
    baseOid: 'base1',
    updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    mergedAt: null,
  };
}

function setup(options: { scouts?: string; calls?: number } = {}): { h: Harness; file: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pp-scout-intro-'));
  const file = join(dir, 'scouts.md');
  writeFileSync(file, options.scouts ?? '');
  const config = join(dir, 'config.json');
  const h = makeHarness({ scoutsFile: file, catchUpCallsPerDay: options.calls ?? 50, userConfig: new UserConfigFile(config, () => {}) });
  h.store.meta.set('viewer', JSON.stringify({ login: 'alice', teams: [] }));
  return { h, file, config };
}

function onGitHub(h: Harness, count: number): void {
  const listing = Array.from({ length: count }, (_, index) => candidate(index + 1));
  h.reader.scoutListings.set('acme/app', listing);
  for (const pr of listing) {
    h.reader.scoutFileLists.set(pr.key, { headOid: pr.headOid, baseOid: 'base1', foldersOid: 'base1', stackedOn: null, files: [{ path: `svc${pr.key.split('#')[1]}/main.ts`, changeType: 'ADDED' }] });
  }
  h.reader.scoutTrees.set('base1', ['src']);
}

describe('the Scouts intro card', () => {
  it('opens by itself without scouts until Not now, which config.json keeps', async () => {
    const { h, config } = setup();
    expect(await h.engine.scoutIntroState()).toMatchObject({ autoShow: true, scouts: 0 });

    await h.engine.dismissScoutIntro();

    expect((await h.engine.scoutIntroState()).autoShow).toBe(false);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toMatchObject({ scoutsIntroDismissedAt: NOW.toISOString() });
  });

  it('never opens by itself once a scout exists', async () => {
    const { h } = setup({ scouts: '## Lookout\nrepos: acme/app\n\nx\n' });
    expect((await h.engine.scoutIntroState()).autoShow).toBe(false);
  });

  it('drafts the prompt with one agent call, or says it is capped', async () => {
    const { h } = setup();
    h.runner.answer('scout_draft', { prompt: PROMPT });
    expect(await h.engine.draftScout()).toEqual({ text: PROMPT, why: 'drafted' });
    expect((await setup({ calls: 0 }).h.engine.draftScout()).why).toBe('capped');
  });

  it('checks the scout with a dry run that writes nothing and stops at 5 judge calls', async () => {
    const { h, file } = setup();
    onGitHub(h, 70);
    h.runner.answer('scout_check', { fit: 'fits', note: 'Folders show in paths.', cantSee: null, name: 'Lookout', paths: ['+*/'], pathsCoverAll: true });
    for (let call = 0; call < 5; call++) {
      const keys = Array.from({ length: 12 }, (_, index) => call * 12 + index + 1);
      h.runner.answer('scout_judge', { judgements: keys.map((number) => ({ prKey: `acme/app#${number}`, verdict: number % 10 === 1 ? 'pull' : 'skip', reason: `adds svc${number}/` })) });
    }

    const result = await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });

    expect(result).toMatchObject({ ok: true, fit: { verdict: 'fits' }, name: 'Lookout', paths: ['+*/'] });
    expect(result.trial).toMatchObject({ days: 2, pulled: 6, candidates: 70, complete: false });
    expect(result.trial?.examples.map((example) => example.prKey)).toEqual([1, 11, 21, 31, 41, 51].map((number) => `acme/app#${number}`));
    expect(result.trial?.examples[0]).toEqual({ prKey: 'acme/app#1', title: 'Add service 1', reason: 'adds svc1/' });
    // Near misses: a path match the judge skipped, with its reason; at most 3.
    expect(result.trial?.nearMisses).toEqual([2, 3, 4].map((number) => ({ prKey: `acme/app#${number}`, title: `Add service ${number}`, reason: `adds svc${number}/` })));
    expect(result.trial?.session).toEqual(expect.any(String));
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(5);
    // Scheduled like a sync: only what the 5 calls can judge gets its files read.
    expect(result.trial?.problem).toBe('more PRs than one check judges');
    expect(h.telemetry.events.filter((entry) => entry.event === 'scout_checked').map((entry) => entry.props)).toEqual([
      { fit: 'fits', cant_see: false, dry_run_pulls: 6, dry_run_complete: false },
    ]);
    const filesRead = h.reader.scoutCalls.filter((call) => call.startsWith('files ')).flatMap((call) => call.slice('files '.length).split(','));
    expect(filesRead).toHaveLength(60);
    // Nothing saved: no judgement, pull, cursor, resume point, snapshot or version (only the calls' accounting rows).
    const count = (table: string) => (h.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(['scout_judgement', 'pr_scouted', 'scout_cursor', 'scouts_version', 'pr'].map(count)).toEqual([0, 0, 0, 0, 0]);
    expect(h.store.meta.get('scout_listing_resume:acme/app')).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe('');

    // A second check gets its own 5 calls.
    h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: 'Lookout', paths: ['+*/'], pathsCoverAll: true });
    h.runner.answer('scout_judge', { judgements: [] });
    await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });
    expect(h.runner.promptsFor('scout_judge').length).toBeGreaterThan(5);
  });

  it('turns a scout on into scouts.md as an intro version, and the card is answered', async () => {
    const { h, file } = setup({ scouts: '## Billing\nrepos: acme/billing\n\nInvoices.\n' });
    const result = await h.engine.turnOnScout({ name: 'Lookout · structure', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'] });

    expect(result).toMatchObject({ ok: true, message: 'Scout on: Lookout · structure. Finds show under Scouted after the next sync.' });
    expect(readFileSync(file, 'utf8')).toContain('## Lookout · structure\nrepos: acme/app\npaths: +*/\n\n' + PROMPT);
    expect(h.store.scoutsVersions.latest()).toMatchObject({ origin: 'intro' });
    expect((await h.engine.listScouts()).map((scout) => scout.id)).toEqual(['billing', 'lookout-structure']);
    expect((await h.engine.scoutIntroState()).autoShow).toBe(false);
  });

  it('keeps a scout turned on when the card answer cannot be saved, and keeps Not now unsaved as a failure', async () => {
    const { h, file, config } = setup({ scouts: '## Billing\nrepos: acme/billing\n\nInvoices.\n' });
    writeFileSync(config, '{ not json');

    const result = await h.engine.turnOnScout({ name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: [] });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('## Lookout');
    expect(await h.engine.dismissScoutIntro()).toMatchObject({ ok: false, message: expect.stringContaining('Could not save') });
  });

  it('gives each check its own runner and call budget, apart from any sync run', async () => {
    const { h } = setup();
    onGitHub(h, 70);
    for (let check = 0; check < 2; check++) {
      h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: 'Lookout', paths: [] });
    }
    for (let call = 0; call < 10; call++) {
      h.runner.answer('scout_judge', { judgements: [] });
    }

    const [first, second] = await Promise.all([h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] }), h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] })]);

    expect(h.runner.promptsFor('scout_judge')).toHaveLength(10);
    expect([first.trial?.judged, second.trial?.judged]).toEqual([60, 60]);
    const runs = h.store.db.prepare("SELECT DISTINCT run_id FROM agent_call WHERE kind = 'scout_judge'").all() as { run_id: string }[];
    expect(runs.every((row) => row.run_id.startsWith('scout-check:'))).toBe(true);
  });

  it('skips the dry run, and every GitHub read, when the check took the day\'s last agent call', async () => {
    const { h } = setup({ calls: 1 });
    onGitHub(h, 3);
    h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: 'Lookout', paths: [], pathsCoverAll: false });

    const result = await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });

    expect(result.ok).toBe(true);
    expect(result.trial).toMatchObject({ problem: 'no agent calls left today for a dry run', candidates: 0, complete: false });
    expect(h.reader.scoutCalls).toEqual([]);
    expect(h.telemetry.events.filter((entry) => entry.event === 'scout_checked').map((entry) => entry.props)).toEqual([
      { fit: 'fits', cant_see: false, dry_run_skipped_reason: 'no_calls_left' },
    ]);
  });

  it('reports a check without a scouts file as one with no dry run, and a refused check not at all', async () => {
    const h = makeHarness({ catchUpCallsPerDay: 50 });
    h.store.meta.set('viewer', JSON.stringify({ login: 'alice', teams: [] }));
    h.runner.answer('scout_check', { fit: 'partly', note: 'ok', cantSee: { part: 'other teams', why: 'teams are not in PR data' }, name: 'Lookout', paths: [], pathsCoverAll: false });

    await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });
    await h.engine.checkScout({ prompt: '', repos: ['acme/app'] });

    expect(h.telemetry.events.filter((entry) => entry.event === 'scout_checked').map((entry) => entry.props)).toEqual([
      { fit: 'partly', cant_see: true, dry_run_skipped_reason: 'no_scouts_file' },
    ]);
  });

  it('refuses a check whose prompt would not turn on as written, before any call or read', async () => {
    const { h } = setup();
    onGitHub(h, 3);
    h.reader.scoutListings.set('acme/other', [candidate(9)]);

    const result = await h.engine.checkScout({ prompt: 'repos: acme/other\nFind changes to billing.', repos: ['acme/app'] });

    expect(result).toMatchObject({ ok: false, trial: null });
    expect(result.message).toContain('could not be turned on as written');
    expect(h.runner.promptsFor('scout_check')).toEqual([]);
    expect(h.reader.scoutCalls).toEqual([]);
  });

  it('starts the name field with a name that turns on: a fallback for one with no id, a step past one in use', async () => {
    const { h } = setup({ scouts: '## Scout app\nrepos: acme/app\n\nx\n' });
    h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: '结构哨兵', paths: [], pathsCoverAll: false });

    const result = await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });

    expect(result.name).toBe('Scout app 2');
    expect((await h.engine.turnOnScout({ name: result.name, prompt: PROMPT, repos: ['acme/app'], paths: [] })).ok).toBe(true);
  });

  it('reports a scout turned on once scouts.md has it, even when its history row fails', async () => {
    const { h, file } = setup();
    vi.spyOn(h.store.scoutsVersions, 'add').mockImplementationOnce(() => {
      throw new Error('database or disk is full');
    });

    const result = await h.engine.turnOnScout({ name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: [] });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('## Lookout');
  });

  it('previews only finds the scout would show: a PR another scout owns does not count', async () => {
    const { h } = setup();
    onGitHub(h, 2);
    h.store.scoutedPrs.insert({ prKey: 'acme/app#1', scoutId: 'billing', scoutName: 'Billing', configVersion: 1, reason: 'invoices', pulledAt: NOW.toISOString(), seenUpdatedAt: null, followedAt: null, dismissedAt: null, dismissReason: null, expiredAt: null, expiryReason: null });
    h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: 'Lookout', paths: [], pathsCoverAll: false });
    h.runner.answer('scout_judge', { judgements: [1, 2].map((number) => ({ prKey: `acme/app#${number}`, verdict: 'pull', reason: `adds svc${number}/` })) });

    const result = await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });

    expect(result.trial).toMatchObject({ pulled: 1, examples: [{ prKey: 'acme/app#2' }] });
  });

  it('refuses a name another scout has', async () => {
    const { h } = setup({ scouts: '## Lookout\nrepos: acme/app\n\nx\n' });
    expect((await h.engine.turnOnScout({ name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: [] })).ok).toBe(false);
  });

  /** A check of 70 PRs whose 5 judge calls pull #1, #11, #21, #31, #41 and #51. */
  async function checked(h: Harness) {
    onGitHub(h, 70);
    h.runner.answer('scout_check', { fit: 'fits', note: 'ok', cantSee: null, name: 'Lookout', paths: ['+*/'], pathsCoverAll: true });
    answerJudge(h, (number) => number % 10 === 1);
    return h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });
  }

  /** Five judge answers over the 60 PRs a trial schedules. */
  function answerJudge(h: Harness, pull: (number: number) => boolean): void {
    for (let call = 0; call < 5; call++) {
      const keys = Array.from({ length: 12 }, (_, index) => call * 12 + index + 1);
      h.runner.answer('scout_judge', { judgements: keys.map((number) => ({ prKey: `acme/app#${number}`, verdict: pull(number) ? 'pull' : 'skip', reason: `adds svc${number}/` })) });
    }
  }

  const LABELS = [
    { prKey: 'acme/app#1', label: 'want' as const, why: 'a new service' },
    { prKey: 'acme/app#11', label: 'want' as const, why: '' },
    { prKey: 'acme/app#21', label: 'noise' as const, why: 'only a rename' },
  ];

  it('tightens from the labels: one scout_refine call, then the dry run again on the kept reads, judge calls only', async () => {
    const { h } = setup();
    const first = await checked(h);
    const readsAfterCheck = [...h.reader.scoutCalls];
    h.runner.answer('scout_refine', { prompt: `${PROMPT} Skip renames.`, paths: ['+*/', 'svc1*/**', 'not a hint'], summary: 'Added a skip rule for renames.' });
    answerJudge(h, (number) => number === 1 || number === 21);

    const result = await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });

    expect(result).toMatchObject({ ok: true, refined: { prompt: `${PROMPT} Skip renames.`, paths: ['+*/', 'svc1*/**'], summary: 'Added a skip rule for renames.', droppedHints: 1 } });
    expect(result.trial).toMatchObject({ pulled: 2, session: first.trial!.session });
    // #11 was pulled before and is wanted: lost. #21 is noise, #1 is still pulled.
    expect(result.lostWants).toEqual([{ prKey: 'acme/app#11', title: 'Add service 11', reason: 'adds svc11/' }]);
    // No GitHub read at all: the listing and the file lists come from the check.
    expect(h.reader.scoutCalls).toEqual(readsAfterCheck);
    expect(h.runner.promptsFor('scout_refine')).toHaveLength(1);
    expect(h.runner.promptsFor('scout_refine')[0]).toContain('=== acme/app#21: NOISE');
    // The cap: 5 judge calls for the check, 5 for the re-run.
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(10);
    // Counted like scout_check, an action call; the re-run's judge calls in a run of their own, never a sync's.
    const runs = h.store.db.prepare('SELECT kind, run_id FROM agent_call ORDER BY id').all() as { kind: string; run_id: string }[];
    expect(runs.filter((row) => row.kind === 'scout_refine').map((row) => row.run_id)).toEqual(['action']);
    expect(runs.slice(-5).every((row) => row.kind === 'scout_judge' && row.run_id.startsWith('scout-refine:'))).toBe(true);
    expect(h.telemetry.events.filter((entry) => entry.event === 'scout_tightened').map((entry) => entry.props)).toEqual([
      { round: 1, wants: 2, noise: 1, pulls_before: 6, pulls_after: 2, lost_wants: 1 },
    ]);
  });

  it('counts the refine against the daily allowance and re-runs only with the calls left', async () => {
    // 1 check + 5 judge calls + 1 refine leave 1 call for the re-run.
    const { h } = setup({ calls: 8 });
    const first = await checked(h);
    h.runner.answer('scout_refine', { prompt: `${PROMPT} Skip renames.`, paths: ['+*/'], summary: 'Added a skip rule.' });
    answerJudge(h, () => true);

    const result = await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });

    expect(result.ok).toBe(true);
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(6);
    expect(result.trial).toMatchObject({ judged: 12, complete: false, problem: 'more PRs than one check judges' });
    // The day is spent now: the next tightening is refused before any call.
    const again = await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: `${PROMPT} Skip renames.`, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });
    expect(again).toMatchObject({ ok: false, message: expect.stringContaining('used up') });
    expect(h.runner.promptsFor('scout_refine')).toHaveLength(1);
  });

  it('tightens again from an undone version, which the session still knows', async () => {
    const { h } = setup();
    const first = await checked(h);
    h.runner.answer('scout_refine', { prompt: `${PROMPT} Skip renames.`, paths: ['+*/'], summary: 'Added a skip rule.' });
    answerJudge(h, (number) => number === 1);
    await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });
    h.runner.answer('scout_refine', { prompt: `${PROMPT} Skip docs.`, paths: ['+*/'], summary: 'Added a skip rule for docs.' });
    answerJudge(h, (number) => number % 10 === 1);

    // Undo is card state: the card sends the first version again.
    const result = await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });

    expect(result).toMatchObject({ ok: true, lostWants: [] });
    expect(h.telemetry.events.filter((entry) => entry.event === 'scout_tightened').map((entry) => entry.props)).toMatchObject([{ round: 1, lost_wants: 1 }, { round: 2, lost_wants: 0, pulls_before: 6 }]);
  });

  it('refuses to tighten without the dry run it names or with fewer than 3 labels, before any call', async () => {
    const { h } = setup();
    const first = await checked(h);
    const request = { session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS };

    expect(await h.engine.refineScout({ ...request, session: 'gone' })).toMatchObject({ ok: false, message: expect.stringContaining('no longer kept') });
    expect(await h.engine.refineScout({ ...request, prompt: 'Something else.' })).toMatchObject({ ok: false, message: expect.stringContaining('no dry run') });
    expect(await h.engine.refineScout({ ...request, labels: LABELS.slice(0, 2) })).toMatchObject({ ok: false, message: expect.stringContaining('at least 3') });
    // A label on a PR no dry run read cannot be described, so it does not count.
    expect(await h.engine.refineScout({ ...request, labels: [...LABELS.slice(0, 2), { prKey: 'acme/app#999', label: 'noise', why: '' }] })).toMatchObject({ ok: false });
    expect(h.runner.promptsFor('scout_refine')).toEqual([]);
  });

  it('refuses a tightened prompt that would not turn on as written, without a re-run', async () => {
    const { h } = setup();
    const first = await checked(h);
    h.runner.answer('scout_refine', { prompt: 'repos: acme/other\nEverything.', paths: ['+*/'], summary: 'Widened.' });

    const result = await h.engine.refineScout({ session: first.trial!.session!, name: 'Lookout', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'], labels: LABELS });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('could not be turned on as written') });
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(5);
  });

  it('defaults the picker to the busiest repo on the board', async () => {
    const { h } = setup();
    h.store.prs.upsert(makePr({ number: 1, repo: 'acme/web' }), NOW.toISOString());
    expect((await h.engine.scoutIntroState()).mainRepo).toBe('acme/web');
  });
});
