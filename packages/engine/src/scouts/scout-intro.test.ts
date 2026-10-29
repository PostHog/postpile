import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScoutCandidate } from '@postpile/core';
import { makePr } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
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
    h.reader.scoutFileLists.set(pr.key, { headOid: pr.headOid, baseOid: 'base1', files: [{ path: `svc${pr.key.split('#')[1]}/main.ts`, changeType: 'ADDED' }] });
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
    h.runner.answer('scout_check', { fit: 'fits', note: 'Folders show in paths.', cantSee: null, name: 'Lookout', paths: ['+*/'] });
    for (let call = 0; call < 5; call++) {
      const keys = Array.from({ length: 12 }, (_, index) => call * 12 + index + 1);
      h.runner.answer('scout_judge', { judgements: keys.map((number) => ({ prKey: `acme/app#${number}`, verdict: number % 10 === 1 ? 'pull' : 'skip', reason: `adds svc${number}/` })) });
    }

    const result = await h.engine.checkScout({ prompt: PROMPT, repos: ['acme/app'] });

    expect(result).toMatchObject({ ok: true, fit: { verdict: 'fits' }, name: 'Lookout', paths: ['+*/'] });
    expect(result.trial).toMatchObject({ days: 2, pulled: 6, candidates: 70, complete: false, problem: 'stopped at the agent-call cap' });
    expect(result.trial?.examples).toEqual([
      { prKey: 'acme/app#1', title: 'Add service 1', reason: 'adds svc1/' },
      { prKey: 'acme/app#11', title: 'Add service 11', reason: 'adds svc11/' },
    ]);
    expect(h.runner.promptsFor('scout_judge')).toHaveLength(5);
    // Nothing saved: no judgement, pull, cursor, resume point, snapshot or version (only the calls' accounting rows).
    const count = (table: string) => (h.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(['scout_judgement', 'pr_scouted', 'scout_cursor', 'scouts_version', 'pr'].map(count)).toEqual([0, 0, 0, 0, 0]);
    expect(h.store.meta.get('scout_listing_resume:acme/app')).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe('');
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
