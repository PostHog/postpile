import { describe, expect, it } from 'vitest';
import { codeownersPatternRegex } from './codeowners.ts';
import { globPathMatches, segmentMatches } from './glob-match.ts';

const PATTERNS = ['src/**/', '**/', '*.md', 'docs/', 'docs/*', 'docs/**', '/docs', 'docs', 'services/*/api/**', '**/api', 'a/**/b', 'src/?.ts', '*', '**', 'README.md', '/build/', 'apps/*/src/*.ts'];
const PATHS = ['src/main.ts', 'src/a/main.ts', 'README.md', 'docs/a.md', 'docs/build/b.md', 'docs', 'src/docs/x.ts', 'services/billing/api/routes.ts', 'services/billing/web/x.ts', 'api', 'pkg/api', 'pkg/api/x', 'a/b', 'a/x/y/b', 'a/b/c', 'src/a.ts', 'src/ab.ts', 'build/out.js', 'x/build/out.js', 'apps/web/src/main.ts', 'apps/web/src/deep/main.ts'];

describe('globPathMatches', () => {
  it('agrees with the CODEOWNERS regex on every pattern and path', () => {
    for (const pattern of PATTERNS) {
      const regex = codeownersPatternRegex(pattern)!;
      for (const path of PATHS) {
        expect([pattern, path, globPathMatches(pattern, path)]).toEqual([pattern, path, regex.test(path)]);
      }
    }
  });

  it('stays fast with many globstars against a deep path', () => {
    const hint = `${'**/'.repeat(30)}x.ts`;
    const path = `${'d/'.repeat(100)}y.ts`;
    const started = performance.now();
    expect(globPathMatches(hint, path)).toBe(false);
    expect(globPathMatches(hint, `${'d/'.repeat(100)}x.ts`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('never runs out of stack, however many globstars a pattern has', () => {
    expect(globPathMatches(`${'**/'.repeat(10_000)}x.ts`, 'y.ts')).toBe(false);
    expect(globPathMatches(`${'**/'.repeat(10_000)}x.ts`, 'a/x.ts')).toBe(true);
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
    // A "*" stays a wildcard, even against a literal "*".
    expect(segmentMatches('*.ts', '*abc.ts')).toBe(true);
    expect(segmentMatches('a*', '*')).toBe(false);
  });
});
