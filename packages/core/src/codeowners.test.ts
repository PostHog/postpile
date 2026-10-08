import { describe, expect, it } from 'vitest';
import { codeownersPatternRegex, fileLines, ownersOfPath, parseCodeowners, reviewOwnership, viewerOpenThreads } from './codeowners.ts';
import { makeComment, makePr, makeThread } from './fixtures.ts';
import type { PrFile, Viewer } from './types.ts';

function matches(pattern: string, path: string): boolean {
  return codeownersPatternRegex(pattern)?.test(path) ?? false;
}

function file(path: string, additions = 1, deletions = 0): PrFile {
  return { path, additions, deletions };
}

describe('codeownersPatternRegex', () => {
  it('matches everything with *', () => {
    expect(matches('*', 'a.ts')).toBe(true);
    expect(matches('*', 'deep/down/a.ts')).toBe(true);
  });

  it('matches an extension anywhere', () => {
    expect(matches('*.js', 'app.js')).toBe(true);
    expect(matches('*.js', 'src/lib/app.js')).toBe(true);
    expect(matches('*.js', 'src/app.ts')).toBe(false);
  });

  it('anchors a leading slash to the root', () => {
    expect(matches('/build/logs/', 'build/logs/a.log')).toBe(true);
    expect(matches('/build/logs/', 'build/logs/deep/a.log')).toBe(true);
    expect(matches('/build/logs/', 'other/build/logs/a.log')).toBe(false);
    expect(matches('/turbo.json', 'turbo.json')).toBe(true);
    expect(matches('/turbo.json', 'sub/turbo.json')).toBe(false);
  });

  it('matches a directory pattern without a slash prefix anywhere', () => {
    expect(matches('apps/', 'apps/web/index.ts')).toBe(true);
    expect(matches('apps/', 'packages/apps/index.ts')).toBe(true);
    expect(matches('apps/', 'apps')).toBe(false);
  });

  it('anchors a pattern with an inner slash', () => {
    expect(matches('docs/getting-started.md', 'docs/getting-started.md')).toBe(true);
    expect(matches('docs/getting-started.md', 'site/docs/getting-started.md')).toBe(false);
  });

  it('keeps docs/* to the directory itself, like GitHub', () => {
    expect(matches('docs/*', 'docs/getting-started.md')).toBe(true);
    expect(matches('docs/*', 'docs/build-app/troubleshooting.md')).toBe(false);
  });

  it('covers everything under a named file or directory', () => {
    expect(matches('/.github', '.github/workflows/ci.yml')).toBe(true);
    expect(matches('turbo.json', 'turbo.json')).toBe(true);
  });

  it('reads ** at the start, middle and end', () => {
    expect(matches('**/logs', 'build/logs/a.log')).toBe(true);
    expect(matches('**/logs', 'logs/a.log')).toBe(true);
    expect(matches('**/logs', 'deeply/nested/logs')).toBe(true);
    expect(matches('docs/**', 'docs/a/b.md')).toBe(true);
    expect(matches('docs/**', 'other/docs/a.md')).toBe(false);
    expect(matches('a/**/b.ts', 'a/b.ts')).toBe(true);
    expect(matches('a/**/b.ts', 'a/x/y/b.ts')).toBe(true);
  });

  it('keeps ? inside one segment and dots literal', () => {
    expect(matches('file?.txt', 'file1.txt')).toBe(true);
    expect(matches('file?.txt', 'file/.txt')).toBe(false);
    expect(matches('a.txt', 'abtxt')).toBe(false);
  });

  it('skips what GitHub does not support', () => {
    expect(codeownersPatternRegex('!keep.ts')).toBeNull();
    expect(codeownersPatternRegex('[ab].ts')).toBeNull();
    expect(codeownersPatternRegex('\\#file')).toBeNull();
    expect(codeownersPatternRegex('/')).toBeNull();
  });
});

describe('parseCodeowners', () => {
  const rules = parseCodeowners(
    [
      '# Default owners',
      '*       @acme/team-core',
      '',
      '/.github/workflows/  @acme/team-devex @Alice # CI',
      '/.github/workflows/release.yml',
      'docs/   docs@example.com @acme/Docs',
      '[bad].ts @acme/nobody',
    ].join('\n'),
  );

  it('keeps rules in file order, owners lower case without @, emails and comments dropped', () => {
    expect(rules.map((rule) => [rule.pattern, rule.owners])).toEqual([
      ['*', ['acme/team-core']],
      ['/.github/workflows/', ['acme/team-devex', 'alice']],
      ['/.github/workflows/release.yml', []],
      ['docs/', ['acme/docs']],
    ]);
  });

  it('lets the last matching rule win', () => {
    expect(ownersOfPath(rules, 'src/app.ts')).toEqual(['acme/team-core']);
    expect(ownersOfPath(rules, '.github/workflows/ci.yml')).toEqual(['acme/team-devex', 'alice']);
  });

  it('gives no owner when the winning line has none', () => {
    expect(ownersOfPath(rules, '.github/workflows/release.yml')).toEqual([]);
  });

  it('gives no owner when nothing matches', () => {
    expect(ownersOfPath(parseCodeowners('/src/ @acme/web'), 'README.md')).toEqual([]);
  });
});

describe('reviewOwnership', () => {
  const rules = parseCodeowners(['* @acme/team-core', '/.github/ @acme/team-devex', '/bin/ @acme/team-devex', '/docs/ @acme/docs @viewer'].join('\n'));
  const viewer: Viewer = { login: 'viewer', teams: ['acme/team-devex', 'acme/reviewers'], homeTeams: ['acme/team-devex'] };
  const files = [file('.github/workflows/ci.yml', 12, 3), file('src/app.ts', 300, 100), file('src/b.ts', 50, 10), file('docs/x.md', 4, 0)];

  it('lists the requested teams, then home teams, each only when it owns files', () => {
    const pr = makePr({ files, changedFiles: 4, reviewerTeams: ['acme/team-core', 'acme/reviewers'] });
    const ownership = reviewOwnership(rules, pr, viewer);
    expect(ownership?.owners.map((entry) => [entry.owner, entry.requested, entry.files.map((f) => f.path)])).toEqual([
      ['acme/team-core', true, ['src/app.ts', 'src/b.ts']],
      ['acme/team-devex', false, ['.github/workflows/ci.yml']],
    ]);
  });

  it("counts the viewer's home teams and own login as their part", () => {
    const pr = makePr({ files, changedFiles: 4, reviewerTeams: ['acme/team-devex'] });
    const ownership = reviewOwnership(rules, pr, viewer);
    expect(ownership?.yours.map((f) => f.path)).toEqual(['.github/workflows/ci.yml', 'docs/x.md']);
    expect(fileLines(ownership?.yours ?? [])).toEqual({ additions: 16, deletions: 3 });
  });

  it('counts a requested routing team of the viewer as theirs too', () => {
    const routing = parseCodeowners('/src/ @acme/reviewers');
    const pr = makePr({ files, changedFiles: 4, reviewerTeams: ['reviewers'] });
    expect(reviewOwnership(routing, pr, viewer)?.yours.map((f) => f.path)).toEqual(['src/app.ts', 'src/b.ts']);
  });

  it('matches a requested bare slug against the org/slug owner', () => {
    const pr = makePr({ files, changedFiles: 4, reviewerTeams: ['team-devex'] });
    expect(reviewOwnership(rules, pr, viewer)?.owners[0]?.files.map((f) => f.path)).toEqual(['.github/workflows/ci.yml']);
  });

  it('lists a requested bare slug once, not again as the home team', () => {
    const pr = makePr({ files, changedFiles: 4, reviewerTeams: ['team-devex'] });
    expect(reviewOwnership(rules, pr, viewer)?.owners.map((entry) => [entry.owner, entry.requested])).toEqual([['team-devex', true]]);
  });

  it('never reads a team named like the viewer as the viewer', () => {
    const named = parseCodeowners('/src/ @acme/viewer');
    expect(reviewOwnership(named, makePr({ files, changedFiles: 4 }), viewer)?.yours).toEqual([]);
  });

  it('says how many files GitHub listed against the total', () => {
    const pr = makePr({ files, changedFiles: 250 });
    expect(reviewOwnership(rules, pr, null)).toMatchObject({ filesListed: 4, filesTotal: 250, owners: [], yours: [] });
  });

  it('says nothing when the snapshot has no file list', () => {
    expect(reviewOwnership(rules, makePr({ files: [], changedFiles: 3 }), viewer)).toBeNull();
  });
});

describe('viewerOpenThreads', () => {
  const asks = makeThread('t1', [makeComment({ author: 'viewer' }), makeComment({ author: 'alice' })]);
  const others = makeThread('t2', [makeComment({ author: 'bob' })]);
  const botOnly = makeThread('t3', [makeComment({ author: 'reviewbot-bot' })]);
  const resolved = { ...makeThread('t4', [makeComment({ author: 'viewer' })]), isResolved: true };

  it("counts unresolved threads the viewer wrote in on someone else's PR", () => {
    expect(viewerOpenThreads(makePr({ author: 'alice', threads: [asks, others, botOnly, resolved] }), 'viewer')).toBe(1);
  });

  it("counts threads waiting on the viewer on their own PR, not a bot's last word", () => {
    expect(viewerOpenThreads(makePr({ author: 'viewer', threads: [asks, others, botOnly, resolved] }), 'Viewer')).toBe(2);
  });
});
