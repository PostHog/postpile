import { describe, expect, it } from 'vitest';
import { codeownersPatternRegex } from './codeowners.ts';
import { globPathMatches, segmentMatches } from './glob-match.ts';

const PATTERNS = ['*.md', 'docs/', 'docs/*', 'docs/**', '/docs', 'docs', 'services/*/api/**', '**/api', 'a/**/b', 'src/?.ts', '*', '**', 'README.md', '/build/', 'apps/*/src/*.ts'];
const PATHS = ['README.md', 'docs/a.md', 'docs/build/b.md', 'docs', 'src/docs/x.ts', 'services/billing/api/routes.ts', 'services/billing/web/x.ts', 'api', 'pkg/api', 'pkg/api/x', 'a/b', 'a/x/y/b', 'a/b/c', 'src/a.ts', 'src/ab.ts', 'build/out.js', 'x/build/out.js', 'apps/web/src/main.ts', 'apps/web/src/deep/main.ts'];

describe('globPathMatches', () => {
  it('agrees with the CODEOWNERS regex on every pattern and path', () => {
    for (const pattern of PATTERNS) {
      const regex = codeownersPatternRegex(pattern)!;
      for (const path of PATHS) {
        expect([pattern, path, globPathMatches(pattern, path)]).toEqual([pattern, path, regex.test(path)]);
      }
    }
  });

  it('stays fast on a hint built to backtrack', () => {
    const hint = `${'a*'.repeat(20)}b`;
    const path = `${'a'.repeat(80)}c`;
    const started = performance.now();
    expect(globPathMatches(hint, path)).toBe(false);
    expect(globPathMatches(`src/${hint}/**`, `src/${path}/x.ts`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('segmentMatches', () => {
  it('matches * and ? inside one segment', () => {
    expect(segmentMatches('*.ts', 'app.ts')).toBe(true);
    expect(segmentMatches('a?c', 'abc')).toBe(true);
    expect(segmentMatches('a*b*c', 'axxbyyc')).toBe(true);
    expect(segmentMatches('a*b*c', 'axxbyy')).toBe(false);
    expect(segmentMatches('**', '')).toBe(true);
  });
});
