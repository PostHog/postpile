import type { SetupChecksView, SetupSweepView } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { formatSetupDraft } from './format-setup.ts';

const checks: SetupChecksView = {
  checks: [{ id: 'gh', label: 'GitHub CLI (gh) installed', state: 'ok', detail: 'gh version 2.60.0', fix: null }],
  login: 'alice',
  canContinue: true,
  agentAvailable: true,
};

const sweep: SetupSweepView = {
  running: false,
  startedAt: '2026-09-28T10:00:00.000Z',
  finishedAt: '2026-09-28T10:00:30.000Z',
  lines: [{ step: 'viewer', text: 'Signed in as @alice', state: 'done' }],
  draft: {
    sections: [
      {
        heading: 'About me',
        claims: [
          { text: 'I am on acme/devex.', sourceIds: ['t1'], fromUser: false },
          { text: 'Keep it short.', sourceIds: [], fromUser: false },
        ],
        body: '',
      },
    ],
    quietRepos: [],
    mainRepo: { repo: 'acme/app', why: 'Most PRs.', sourceIds: ['p1'] },
    repos: [],
    sources: [
      { id: 't1', kind: 'team', label: 'Team acme/devex', detail: 'You are on acme/devex.', url: null },
      { id: 'p1', kind: 'pr', label: 'acme/app#1', detail: 'you wrote it', url: null },
      { id: 'p2', kind: 'pr', label: 'acme/app#2', detail: 'you reviewed it', url: null },
    ],
    summary: 'From your PRs.',
    model: 'opus',
  },
  error: null,
  current: { text: '', version: null },
};

describe('formatSetupDraft', () => {
  it('prints the checks, the sweep, the draft with its citations and the cited sources', () => {
    expect(formatSetupDraft(checks, sweep)).toBe(
      [
        'Checks',
        '  ok      GitHub CLI (gh) installed: gh version 2.60.0',
        '',
        'Sweep',
        '  done    Signed in as @alice',
        '',
        'Draft (opus): From your PRs.',
        '',
        '# About me',
        '- I am on acme/devex. [t1]',
        '- Keep it short. [no source]',
        '',
        'Main repo suggestion: acme/app: Most PRs. [p1]',
        'Quiet repo suggestions:',
        '  none',
        '',
        'Cited sources (2 of 3 offered)',
        '  t1   Team acme/devex: You are on acme/devex.',
        '  p1   acme/app#1: you wrote it',
      ].join('\n'),
    );
  });

  it('stops after the checks when they fail', () => {
    expect(formatSetupDraft({ ...checks, canContinue: false }, null)).toContain('No sweep ran.');
  });
});
