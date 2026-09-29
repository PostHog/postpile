import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_FIXES, type ActivityPr, type SetupSweepView } from '@postpile/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRepoSettings } from './repo-settings.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { loadViewer } from './viewer-meta.ts';

function activity(repo: string, number: number, role: ActivityPr['role']): ActivityPr {
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    title: `Change ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    role,
    state: 'MERGED',
    updatedAt: '2026-08-30T10:00:00.000Z',
    dirs: ['.github/'],
  };
}

const DRAFT_ANSWER = {
  summary: 'From your PRs and CODEOWNERS.',
  sections: [
    { heading: 'About me', claims: [{ text: 'I am on acme/team-platform.', sources: ['t1'] }] },
    { heading: 'What I own', claims: [{ text: 'CI workflows in acme/app.', sources: ['o1', 'p1'] }] },
  ],
  quietRepos: [{ repo: 'acme/docs', why: 'One review.', sources: ['p3'] }],
  mainRepo: { repo: 'acme/app', why: 'Most of your PRs.', sources: ['p1'] },
};

let dir: string;
let file: string;
let h: Harness;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-setup-'));
  file = join(dir, 'instructions.md');
  h = makeHarness({ instructionsFile: file, firstRun: true });
  h.reader.teams.set('acme/team-platform', ['viewer', 'bob']);
  h.reader.activity = [activity('acme/app', 1, 'authored'), activity('acme/app', 2, 'reviewed'), activity('acme/docs', 3, 'reviewed')];
  h.reader.files.set('acme/app:.github/CODEOWNERS', '* @acme/all\n/.github/ @acme/team-platform\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Lets the background sweep finish; it only waits on fakes. */
async function sweepToEnd(): Promise<SetupSweepView> {
  await h.engine.startSetupSweep();
  for (let i = 0; i < 100; i++) {
    const view = await h.engine.setupSweep();
    if (view && !view.running) {
      return view;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('the sweep did not finish');
}

describe('setup status', () => {
  it('is needed on a first run, and not after skip', async () => {
    expect(await h.engine.setupStatus()).toMatchObject({ needed: true, flag: null, hasInstructions: false });
    expect((await h.engine.skipSetup()).ok).toBe(true);
    expect(await h.engine.setupStatus()).toMatchObject({ needed: false, flag: 'skipped' });
  });

  it('is not needed when instructions.md has text', async () => {
    writeFileSync(file, '# About me\n- DevEx.\n');
    expect(await h.engine.setupStatus()).toMatchObject({ needed: false, hasInstructions: true });
  });
});

describe('setup checks', () => {
  it('passes with gh logged in, notifications readable and claude found', async () => {
    const view = await h.engine.setupChecks();
    expect(view.checks.map((check) => [check.id, check.state])).toEqual([
      ['gh', 'ok'],
      ['gh_auth', 'ok'],
      ['notifications', 'ok'],
      ['claude', 'ok'],
    ]);
    expect(view).toMatchObject({ login: 'viewer', canContinue: true, agentAvailable: true });
    expect(view.checks[1]?.detail).toBe('Logged in as @viewer · 1 team');
  });

  it('stops at a missing gh with the install command', async () => {
    h.commands.missing.add('gh');
    const view = await h.engine.setupChecks();
    expect(view.checks.map((check) => check.state)).toEqual(['fail', 'skipped', 'skipped', 'ok']);
    expect(view.checks[0]?.fix).toBe('brew install gh');
    expect(view.canContinue).toBe(false);
  });

  it('asks for gh auth login without a token, and for the scope without notifications', async () => {
    h.commands.failing.add('gh auth token');
    expect((await h.engine.setupChecks()).checks[1]).toMatchObject({ state: 'fail', fix: 'gh auth login' });

    h.commands.failing.clear();
    h.reader.notificationsProblem = 'GitHub GET notifications failed with 403: Missing scope';
    const view = await h.engine.setupChecks();
    expect(view.checks[2]).toMatchObject({ state: 'fail', fix: 'gh auth refresh -h github.com -s notifications' });
    expect(view.canContinue).toBe(false);
  });

  it('only warns about a missing claude', async () => {
    h.commands.missing.add('claude');
    const view = await h.engine.setupChecks();
    expect(view.checks[3]).toMatchObject({ state: 'warn', fix: TOOL_FIXES.installClaude });
    expect(view).toMatchObject({ canContinue: true, agentAvailable: false });
  });
});

describe('setup sweep', () => {
  it('reads the viewer, 30 days of PRs and CODEOWNERS, then drafts once', async () => {
    h.runner.answer('setup_draft', DRAFT_ANSWER);
    const view = await sweepToEnd();

    expect(view.lines.map((line) => [line.step, line.state])).toEqual([
      ['viewer', 'done'],
      ['activity', 'done'],
      ['codeowners', 'done'],
      ['digest', 'skipped'],
      ['draft', 'done'],
    ]);
    expect(view.lines[1]?.text).toBe('Found 3 PRs in 30 days: 1 you wrote, 2 you reviewed, 0 waiting on your review · 2 repos');
    expect(view.lines[2]?.text).toBe('Ownership files: 1 rule names you or your teams (acme/app .github/CODEOWNERS)');
    expect(h.reader.activityCalls).toEqual(['2026-08-03']);
    expect(h.reader.fileCalls).toContain('acme/docs:docs/CODEOWNERS');
    expect(loadViewer(h.store)?.teamMembers).toEqual(['bob']);

    const prompt = h.runner.promptsFor('setup_draft')[0] ?? '';
    expect(prompt).toContain('/.github/ @acme/team-platform');
    expect(prompt).not.toContain('@acme/all');
    expect(view.draft?.sections.map((section) => section.heading)).toEqual(['About me', 'What I own']);
    expect(view.draft?.mainRepo?.repo).toBe('acme/app');
    expect(view.draft?.quietRepos.map((repo) => repo.repo)).toEqual(['acme/docs']);
    expect(view).toMatchObject({ error: null, current: { text: '', version: null } });
  });

  it('reads owners.yaml at the root and in the folders the PRs touch, only where the root has one', async () => {
    h.runner.answer('setup_draft', DRAFT_ANSWER);
    h.reader.files.set('acme/app:owners.yaml', "rules:\n  - match: '/bin/'\n    owners: team-platform\n  - match: '/web/'\n    owners: team-web\n");
    h.reader.files.set('acme/app:.github/owners.yaml', "rules:\n  - match: ['/workflows/', '/actions/']\n    owners: [team-platform, team-security]\n");
    const view = await sweepToEnd();

    expect(view.lines[2]?.text).toBe(
      'Ownership files: 3 rules name you or your teams (acme/app .github/CODEOWNERS, acme/app owners.yaml, acme/app .github/owners.yaml)',
    );
    expect(h.reader.fileCalls).not.toContain('acme/docs:.github/owners.yaml');
    const prompt = h.runner.promptsFor('setup_draft')[0] ?? '';
    expect(prompt).toContain('/bin/ -> owners: team-platform');
    expect(prompt).toContain('/.github/workflows/, /.github/actions/ -> owners: team-platform, team-security');
    expect(prompt).not.toContain('team-web');
  });

  it('falls back to the blank template when the agent fails', async () => {
    const view = await sweepToEnd();
    expect(view.lines.at(-1)?.state).toBe('failed');
    expect(view.error).toContain('The agent could not write a draft');
    expect(view.draft?.model).toBeNull();
    expect(view.draft?.sections.every((section) => section.body === '')).toBe(true);
    expect(view.draft?.mainRepo?.repo).toBe('acme/app');
  });
});

describe('setup fit check', () => {
  const sections = [{ heading: 'Preferences', body: "- Keep summaries short\n- Don't push write-ups onto PR branches" }];

  it('sends the text and keeps the notes on lines it has', async () => {
    h.runner.answer('setup_fit', {
      notes: [{ heading: 'Preferences', line: "Don't push write-ups onto PR branches", kind: 'no_effect', why: 'PostPile never pushes.' }],
    });
    const result = await h.engine.checkSetupFit({ sections });
    expect(result).toMatchObject({ ok: true, notes: [{ heading: 'Preferences', kind: 'no_effect' }] });
    expect(h.runner.promptsFor('setup_fit')[0]).toContain('- Keep summaries short');
    expect(h.telemetry.events.at(-1)).toEqual({ event: 'setup_fit_checked', props: { notes: 1, ok: true } });
  });

  it('asks nothing for an empty text, and says so when the call fails', async () => {
    expect(await h.engine.checkSetupFit({ sections: [{ heading: 'Preferences', body: '  ' }] })).toEqual({ ok: true, message: '', notes: [] });
    expect(h.runner.promptsFor('setup_fit')).toHaveLength(0);
    // Nothing queued: the fake runner fails the call.
    const result = await h.engine.checkSetupFit({ sections });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('The agent could not check the text');
  });
});

describe('the live poll during first-run setup', () => {
  it('waits until setup is accepted or skipped', async () => {
    expect(await h.engine.pollOnce()).toEqual({ kind: 'blocked', reason: 'setup not finished' });
    await h.engine.skipSetup();
    expect((await h.engine.pollOnce()).kind).not.toBe('blocked');
  });
});

describe('setup refine', () => {
  it('sends the edited draft and the message, and says what changed', async () => {
    h.runner.answer('setup_draft', DRAFT_ANSWER);
    await sweepToEnd();
    h.runner.answer('setup_refine', {
      ...DRAFT_ANSWER,
      reply: 'Added the docs line.',
      sections: [
        { heading: 'About me', claims: [{ text: 'I am on acme/team-platform.', sources: ['t1'] }, { text: 'I also help with docs.', sources: [] }] },
        { heading: 'What I own', claims: [{ text: 'CI workflows in acme/app.', sources: ['o1', 'p1'] }] },
      ],
    });

    const result = await h.engine.refineSetup({
      sections: [
        { heading: 'About me', body: '- I am on acme/team-platform.\n- I also help with docs.' },
        { heading: 'What I own', body: '- CI workflows in acme/app.' },
      ],
      message: 'Keep my docs line',
    });

    expect(result).toMatchObject({ ok: true, message: 'Added the docs line.', changedSections: [] });
    expect(result.draft?.sections[0]?.claims[1]).toEqual({ text: 'I also help with docs.', sourceIds: [], fromUser: true });
    expect(h.runner.promptsFor('setup_refine')[0]).toContain('Keep my docs line');
  });

  it('refuses without a finished sweep', async () => {
    expect((await h.engine.refineSetup({ sections: [], message: 'x' })).ok).toBe(false);
  });
});

describe('setup accept', () => {
  const sections = [
    { heading: 'About me', body: '- I am on acme/team-platform.' },
    { heading: 'Preferences', body: '' },
  ];

  it('writes a setup version, the quiet repos, the scope and the done flag', async () => {
    const result = await h.engine.acceptSetup({ sections, quietRepos: ['acme/docs'], mainRepo: 'acme/app', baseVersion: null });

    expect(result).toMatchObject({ ok: true, savedVersion: 1 });
    expect(readFileSync(file, 'utf8')).toBe('# About me\n- I am on acme/team-platform.\n');
    expect(h.store.instructions.latest()).toMatchObject({ version: 1, origin: 'setup', summary: 'Written with setup', sourceChatMessageId: null });
    expect(loadRepoSettings(h.store)).toEqual({ scope: 'acme/app', quiet: ['acme/docs'] });
    expect(await h.engine.setupStatus()).toMatchObject({ needed: false, flag: 'done' });
  });

  it('adds a new version on a re-run, never a silent overwrite', async () => {
    writeFileSync(file, '# About me\n- Old line.\n');
    const before = await h.engine.getInstructions();
    expect(before.version).toBe(1);

    const result = await h.engine.acceptSetup({ sections, quietRepos: [], mainRepo: null, baseVersion: 1 });

    expect(result.savedVersion).toBe(2);
    expect(h.store.instructions.list(10).map((version) => [version.version, version.origin])).toEqual([
      [2, 'setup'],
      [1, 'outside'],
    ]);
    expect(h.store.instructions.latest()?.summary).toBe('Rewritten with setup');
  });

  it('refuses when the file changed since the review, and hands back the new text', async () => {
    writeFileSync(file, '# About me\n- Hand edit.\n');
    const result = await h.engine.acceptSetup({ sections, quietRepos: [], mainRepo: null, baseVersion: null });
    expect(result).toMatchObject({ ok: false, savedVersion: null, current: { text: '# About me\n- Hand edit.\n', version: 1 } });
    expect(readFileSync(file, 'utf8')).toBe('# About me\n- Hand edit.\n');
    expect((await h.engine.setupStatus()).flag).toBeNull();
  });

  it('refuses an empty draft and a bad repo name', async () => {
    expect((await h.engine.acceptSetup({ sections: [{ heading: 'About me', body: ' ' }], quietRepos: [], mainRepo: null, baseVersion: null })).ok).toBe(false);
    expect((await h.engine.acceptSetup({ sections, quietRepos: ['nope'], mainRepo: null, baseVersion: null })).message).toContain('"nope"');
  });
});
