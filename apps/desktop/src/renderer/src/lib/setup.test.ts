import type { SetupDraft } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { acceptPlan, draftText, editsFromDraft, pickMainRepo, picksAfterRefine, picksFromDraft, repoChoices, repoCountText, sourcesFor, toggleQuiet } from './setup.ts';

function repo(name: string, prs: number) {
  return { repo: name, prs, authored: prs > 2 ? 2 : 0, reviewed: prs > 2 ? prs - 2 : prs, requested: 0 };
}

const draft: SetupDraft = {
  sections: [
    { heading: 'About me', claims: [{ text: 'DevEx.', sourceIds: ['t1'], fromUser: false }], body: '- DevEx.' },
    { heading: 'Preferences', claims: [], body: '' },
  ],
  quietRepos: [{ repo: 'acme/rare', why: 'One review.', sourceIds: [] }],
  mainRepo: { repo: 'acme/app', why: 'Most PRs.', sourceIds: [] },
  repos: [repo('acme/app', 9), repo('acme/docs', 3), repo('acme/rare', 1)],
  sources: [
    { id: 't1', kind: 'team', label: 'Team acme/devex', detail: '', url: null },
    { id: 'p1', kind: 'pr', label: 'acme/app#1', detail: '', url: 'https://github.com/acme/app/pull/1' },
  ],
  summary: '',
  model: 'opus',
};

describe('draftText', () => {
  it('writes the sections like the engine, empty ones left out', () => {
    expect(draftText(editsFromDraft(draft))).toBe('# About me\n- DevEx.\n');
    expect(draftText([{ heading: '', body: 'Intro' }, { heading: 'B', body: ' - b ' }])).toBe('Intro\n\n# B\n- b\n');
    expect(draftText([])).toBe('');
  });
});

describe('setup picks', () => {
  it('starts with the quiet suggestions and all repos, the main repo only suggested', () => {
    expect(picksFromDraft(draft)).toEqual({ quiet: ['acme/rare'], touchedQuiet: [], mainRepo: null });
  });

  it("keeps the user's toggles and main repo on a refine, untouched toggles follow the new draft", () => {
    let picks = picksFromDraft(draft);
    picks = toggleQuiet(picks, 'acme/rare', false);
    picks = toggleQuiet(picks, 'acme/docs', true);
    picks = pickMainRepo(picks, 'acme/app');
    const next: SetupDraft = {
      ...draft,
      quietRepos: [
        { repo: 'acme/rare', why: 'Still rare.', sourceIds: [] },
        { repo: 'acme/tools', why: 'Bots only.', sourceIds: [] },
        { repo: 'acme/app', why: 'Wrong.', sourceIds: [] },
      ],
      mainRepo: { repo: 'acme/docs', why: 'Changed its mind.', sourceIds: [] },
    };
    expect(picksAfterRefine(picks, next)).toEqual({ quiet: ['acme/docs', 'acme/tools'], touchedQuiet: ['acme/rare', 'acme/docs'], mainRepo: 'acme/app' });
  });

  it('drops the main repo from the quiet ones', () => {
    expect(pickMainRepo(picksFromDraft(draft), 'acme/rare').quiet).toEqual([]);
  });
});

describe('repoChoices', () => {
  it('keeps the busiest repos and adds a suggestion outside them', () => {
    expect(repoChoices(draft, 1).map((entry) => entry.repo)).toEqual(['acme/app', 'acme/rare']);
    expect(repoChoices(draft).map((entry) => entry.repo)).toEqual(['acme/app', 'acme/docs', 'acme/rare']);
  });
});

describe('sourcesFor', () => {
  it('keeps the cited order and skips unknown ids', () => {
    expect(sourcesFor(['p1', 'x', 't1'], draft.sources).map((source) => source.id)).toEqual(['p1', 't1']);
  });
});

describe('repoCountText', () => {
  it('names only the counts there are', () => {
    expect(repoCountText(repo('a/b', 5))).toBe('5 PRs · 2 yours · 3 reviewed');
    expect(repoCountText({ repo: 'a/b', prs: 1, authored: 0, reviewed: 0, requested: 1 })).toBe('1 PR · 1 waiting');
  });
});

describe('acceptPlan', () => {
  it('says what Accept writes, in order', () => {
    expect(acceptPlan({ baseVersion: null, changed: true, quietRepos: ['acme/rare'], mainRepo: 'acme/app' })).toEqual([
      'Writes instructions.md as version 1, author “setup”.',
      'Makes 1 repo quiet (still synced, never urgent, never pings): acme/rare.',
      'Sets the repo scope to acme/app; the title bar menu changes it back any time.',
      'Then syncs your GitHub notifications and opens your topics.',
    ]);
  });

  it('keeps the old version on a re-run and says when nothing changes', () => {
    expect(acceptPlan({ baseVersion: 3, changed: true, quietRepos: [], mainRepo: null })[0]).toBe(
      'Writes instructions.md as version 4, author “setup” (version 3 stays in the history).',
    );
    expect(acceptPlan({ baseVersion: 3, changed: false, quietRepos: [], mainRepo: null })).toEqual([
      'Leaves instructions.md as it is: the draft says the same.',
      'Keeps all repos in the sidebar.',
      'Then syncs your GitHub notifications and opens your topics.',
    ]);
  });
});
