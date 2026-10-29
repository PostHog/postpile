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
    h.reader.scoutFileLists.set(pr.key, { headOid: pr.headOid, baseOid: 'base1', foldersOid: 'base1', files: [{ path: `svc${pr.key.split('#')[1]}/main.ts`, changeType: 'ADDED' }] });
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
    expect(result.trial?.examples).toEqual([
      { prKey: 'acme/app#1', title: 'Add service 1', reason: 'adds svc1/' },
      { prKey: 'acme/app#11', title: 'Add service 11', reason: 'adds svc11/' },
    ]);
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

  it('defaults the picker to the busiest repo on the board', async () => {
    const { h } = setup();
    h.store.prs.upsert(makePr({ number: 1, repo: 'acme/web' }), NOW.toISOString());
    expect((await h.engine.scoutIntroState()).mainRepo).toBe('acme/web');
  });
});
