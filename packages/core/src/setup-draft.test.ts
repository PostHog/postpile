import { describe, expect, it } from 'vitest';
import type { ActivityPr, SetupMaterial } from './setup.ts';
import {
  blankSetupDraft,
  busiestDirs,
  claimKey,
  codeownersLines,
  mapSetupDraft,
  ownerHandles,
  ownersYamlHandles,
  ownersYamlLines,
  rankActivityRepos,
  setupSources,
  topLevelDirs,
  userWrittenLines,
  type SetupDraftAnswer,
} from './setup-draft.ts';

function activity(repo: string, number: number, role: ActivityPr['role'], dirs: string[] = []): ActivityPr {
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    title: `Change ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    role,
    state: 'OPEN',
    updatedAt: '2026-09-20T10:00:00.000Z',
    dirs,
  };
}

const viewer = { login: 'alice', teams: ['acme/devex', 'acme/infra'], teamMembers: ['bob'] };

const material: SetupMaterial = {
  viewer,
  since: '2026-08-29T00:00:00.000Z',
  prs: [activity('acme/app', 1, 'authored', ['.github/']), activity('acme/docs', 2, 'reviewed')],
  codeowners: [{ repo: 'acme/app', path: '.github/CODEOWNERS', lines: ['/.github/ @acme/devex'] }],
  digest: { version: 3, createdAt: '2026-09-27T09:00:00.000Z', text: 'Alice drives the CI move.' },
};

describe('topLevelDirs', () => {
  it('counts top-level folders, most files first, root files as (root)', () => {
    const paths = ['frontend/a.ts', 'frontend/b.ts', 'backend/api/x.py', 'README.md', 'frontend/c.ts', 'backend/y.py'];
    expect(topLevelDirs(paths)).toEqual(['frontend/', 'backend/', '(root)']);
    expect(topLevelDirs(paths, 1)).toEqual(['frontend/']);
    expect(topLevelDirs([])).toEqual([]);
  });
});

describe('rankActivityRepos', () => {
  it('ranks by PRs, then by PRs the user wrote, and counts each role', () => {
    const repos = rankActivityRepos([
      activity('acme/docs', 1, 'reviewed'),
      activity('acme/app', 2, 'authored'),
      activity('acme/docs', 3, 'review_requested'),
      activity('acme/app', 4, 'reviewed'),
      activity('acme/infra', 5, 'authored'),
    ]);
    expect(repos.map((repo) => repo.repo)).toEqual(['acme/app', 'acme/docs', 'acme/infra']);
    expect(repos[1]).toEqual({ repo: 'acme/docs', prs: 2, authored: 0, reviewed: 1, requested: 1 });
  });
});

describe('ownersYamlLines', () => {
  const file = `version: 1
owners: []
teams:
    devex:
        slack: '#devex'
rules:
    - match: Dockerfile
      owners: frontend
    # Every owners.yaml routes to devex
    - match:
          - '/bin/'
          - owners.yaml # unanchored
      owners: devex
    - match: ['/workflows/', '/actions/']
      owners: [devex, '@carol']
    - match: '/products/*'
      additions: devex
    - match: '/scripts/'
      owners: '@Alice'
other: true
`;

  it('keeps the rules naming the user or a team, patterns from the repo root', () => {
    expect(ownersYamlLines(file, '', ownersYamlHandles(viewer))).toEqual([
      '/bin/, owners.yaml -> owners: devex',
      "/workflows/, /actions/ -> owners: devex, @carol",
      '/products/* -> additions: devex',
      '/scripts/ -> owners: @Alice',
    ]);
    expect(ownersYamlLines(file, '.github/', ['devex'])[0]).toBe('/.github/bin/, /.github/**/owners.yaml -> owners: devex');
  });

  it('keeps nothing without rules or matches', () => {
    expect(ownersYamlLines('version: 1\nowners: [devex]\n', '', ['devex'])).toEqual([]);
    expect(ownersYamlLines(file, '', ['@zed'])).toEqual([]);
  });
});

describe('busiestDirs', () => {
  it("ranks one repo's folders by PRs, without (root)", () => {
    const prs = [
      activity('acme/app', 1, 'authored', ['tools/', '.github/', '(root)']),
      activity('acme/app', 2, 'reviewed', ['.github/']),
      activity('acme/docs', 3, 'reviewed', ['content/']),
    ];
    expect(busiestDirs(prs, 'acme/app')).toEqual(['.github/', 'tools/']);
  });
});

describe('codeownersLines', () => {
  const file = `# Owners
* @acme/everyone
/.github/ @acme/devex @carol   # CI
/frontend/ @acme/frontend
/tools/build/ @Alice
# /old/ @acme/devex
`;

  it('keeps the rules that name the user or their teams, without comments', () => {
    expect(codeownersLines(file, ownerHandles(viewer))).toEqual(['/.github/ @acme/devex @carol', '/tools/build/ @Alice']);
  });

  it('keeps nothing when nobody matches', () => {
    expect(codeownersLines(file, ['@zed'])).toEqual([]);
  });
});

describe('setupSources', () => {
  it('hands out t, p, o and d ids in order, with links where there are any', () => {
    const sources = setupSources(material);
    expect(sources.map((source) => source.id)).toEqual(['t1', 't2', 'p1', 'p2', 'o1', 'd1']);
    expect(sources[2]).toMatchObject({ kind: 'pr', label: 'acme/app#1', url: 'https://github.com/acme/app/pull/1' });
    expect(sources[2]?.detail).toContain('you wrote it');
    expect(sources[4]).toMatchObject({ kind: 'codeowners', url: 'https://github.com/acme/app/blob/HEAD/.github/CODEOWNERS' });
    expect(sources[5]).toMatchObject({ kind: 'digest', label: 'Work context v3', url: null });
  });

  it('has no digest source without a digest', () => {
    expect(setupSources({ ...material, digest: null }).some((source) => source.kind === 'digest')).toBe(false);
  });
});

describe('mapSetupDraft', () => {
  const sources = setupSources(material);
  const repos = rankActivityRepos(material.prs);
  const answer: SetupDraftAnswer = {
    summary: 'Based on 2 PRs and CODEOWNERS.',
    sections: [
      {
        heading: '# About me',
        claims: [
          { text: '- I am on acme/devex.', sources: ['t1', 't1', 'x9'] },
          { text: 'I guess I like tea.', sources: [] },
          { text: '   ', sources: ['p1'] },
        ],
      },
      { heading: 'Preferences', claims: [] },
      { heading: 'What I own', claims: [{ text: 'CI config in acme/app.', sources: ['o1', 'p1', 'p2', 'd1', 't2'] }] },
    ],
    quietRepos: [
      { repo: 'ACME/docs', why: 'Only reviews.', sources: ['p2'] },
      { repo: 'acme/docs', why: 'Twice.', sources: [] },
      { repo: 'acme/app', why: 'Main repo cannot be quiet.', sources: [] },
      { repo: 'other/unknown', why: 'Never seen.', sources: [] },
    ],
    mainRepo: { repo: 'acme/app', why: 'Most PRs.', sources: ['p1'] },
  };

  it('drops unknown source ids and caps them per claim', () => {
    const draft = mapSetupDraft({ answer, sources, repos, model: 'opus' });
    expect(draft.sections.map((section) => section.heading)).toEqual(['About me', 'What I own']);
    expect(draft.sections[0]?.claims).toEqual([
      { text: 'I am on acme/devex.', sourceIds: ['t1'], fromUser: false },
      { text: 'I guess I like tea.', sourceIds: [], fromUser: false },
    ]);
    expect(draft.sections[1]?.claims[0]?.sourceIds).toEqual(['o1', 'p1', 'p2', 'd1']);
    expect(draft.sections[0]?.body).toBe('- I am on acme/devex.\n- I guess I like tea.');
  });

  it('keeps only repos the sweep saw, once, and never the main repo as quiet', () => {
    const draft = mapSetupDraft({ answer, sources, repos, model: 'opus' });
    expect(draft.mainRepo).toEqual({ repo: 'acme/app', why: 'Most PRs.', sourceIds: ['p1'] });
    expect(draft.quietRepos).toEqual([{ repo: 'acme/docs', why: 'Only reviews.', sourceIds: ['p2'] }]);
    expect(mapSetupDraft({ answer: { ...answer, mainRepo: { repo: 'x/y', why: '', sources: [] } }, sources, repos, model: null }).mainRepo).toBeNull();
  });

  it('marks claims the user wrote themselves', () => {
    const draft = mapSetupDraft({ answer, sources, repos, model: 'opus', userLines: new Set([claimKey('- I guess I like tea.')]) });
    expect(draft.sections[0]?.claims[1]?.fromUser).toBe(true);
    expect(draft.sections[0]?.claims[0]?.fromUser).toBe(false);
  });
});

describe('blankSetupDraft', () => {
  it('has the usual headings, no text, and the busiest repo as main', () => {
    const draft = blankSetupDraft([], rankActivityRepos(material.prs), 'No claude CLI.');
    expect(draft.sections.map((section) => section.body)).toEqual(['', '', '', '', '']);
    expect(draft.mainRepo?.repo).toBe('acme/app');
    expect(draft.model).toBeNull();
    expect(blankSetupDraft([], [], 'x').mainRepo).toBeNull();
  });
});

describe('userWrittenLines', () => {
  it('keeps the edited lines the previous draft did not have', () => {
    const previous = blankSetupDraft([], [], 'x');
    previous.sections[0] = { heading: 'About me', claims: [{ text: 'I am on acme/devex.', sourceIds: ['t1'], fromUser: false }], body: '' };
    const edits = [{ body: '- I am on acme/devex.\n- I also help with docs.\n\n' }, { body: '* I also help with docs.' }];
    expect(userWrittenLines(edits, previous)).toEqual(['i also help with docs.']);
    expect(userWrittenLines([{ body: '- New line' }], null)).toEqual(['new line']);
  });
});
