import { describe, expect, it } from 'vitest';
import { parseScouts, scoutHintMatches, scoutSlug } from './scouts-config.ts';

const SAMPLE = `Scouts for PostPile. Text up here is ignored.

## Lookout · structure
repos: acme/app
paths: +*/ (new top-level folder), +services/*/api/**, docs/architecture.md

Pull in PRs that change how the app is shaped: new services,
API facades, contract surfaces.

## Billing watch
id: billing
repos: acme/app, acme/billing

Anything touching how invoices are computed.
`;

describe('scoutSlug', () => {
  it('lower-cases, drops accents and joins words with single dashes', () => {
    expect(scoutSlug('Lookout · structure')).toBe('lookout-structure');
    expect(scoutSlug('  Café -- Ops!  ')).toBe('cafe-ops');
    expect(scoutSlug('···')).toBe('');
  });
});

describe('parseScouts', () => {
  it('reads every scout in file order with its keys and prompt', () => {
    const { scouts, errors } = parseScouts(SAMPLE);

    expect(errors).toEqual([]);
    expect(scouts.map((scout) => scout.id)).toEqual(['lookout-structure', 'billing']);
    const [lookout, billing] = scouts;
    expect(lookout).toMatchObject({ name: 'Lookout · structure', repos: ['acme/app'] });
    expect(lookout!.prompt).toBe('Pull in PRs that change how the app is shaped: new services,\nAPI facades, contract surfaces.');
    expect(lookout!.paths.map(({ pattern, addedOnly, newTopLevelFolder }) => ({ pattern, addedOnly, newTopLevelFolder }))).toEqual([
      { pattern: '*/', addedOnly: true, newTopLevelFolder: true },
      { pattern: 'services/*/api/**', addedOnly: true, newTopLevelFolder: false },
      { pattern: 'docs/architecture.md', addedOnly: false, newTopLevelFolder: false },
    ]);
    expect(scoutHintMatches(lookout!.paths[0]!, 'billing/main.ts')).toBe(false);
    expect(scoutHintMatches(lookout!.paths[1]!, 'services/billing/api/routes.ts')).toBe(true);
    expect(billing).toMatchObject({ id: 'billing', repos: ['acme/app', 'acme/billing'], paths: [], prompt: 'Anything touching how invoices are computed.' });
  });

  it('gives an empty list for an empty file', () => {
    expect(parseScouts('')).toEqual({ scouts: [], errors: [] });
    expect(parseScouts('# My scouts\n\nnone yet\n')).toEqual({ scouts: [], errors: [] });
  });

  it('takes repos split by commas or spaces, each once', () => {
    const { scouts } = parseScouts('## A\nrepos: acme/app acme/web,acme/app\n\nprompt\n');
    expect(scouts[0]!.repos).toEqual(['acme/app', 'acme/web']);
  });

  it('allows blank lines between key lines and keeps ### headings in the prompt', () => {
    const { scouts, errors } = parseScouts('## A\n\nrepos: acme/app\n\npaths: src/**\n\nLook for this.\n### detail\nmore\n');
    expect(errors).toEqual([]);
    expect(scouts[0]!.prompt).toBe('Look for this.\n### detail\nmore');
  });

  it('names the line of each problem', () => {
    const text = ['## A', 'repos: acme', 'paths: !src/**', '', 'prompt', '## B', 'repos: acme/app', '## ', 'repos: acme/app', 'x'].join('\n');
    const { scouts, errors } = parseScouts(text);

    expect(scouts.map((scout) => scout.id)).toEqual([]);
    expect(errors).toEqual([
      'line 2: repo "acme" is not owner/name',
      'line 3: path "!src/**" uses "!", "[ ]" or "\\", which paths do not support',
      'line 6: "B" needs a prompt: text after its key lines saying what to pull in',
      'line 8: a scout needs a name after "## "',
      'line 8: "" has no letters or digits for an id; add an id: line',
    ]);
  });

  it('needs a repos line', () => {
    expect(parseScouts('## A\n\nprompt only\n').errors).toEqual(['line 1: "A" needs a repos: line (owner/name, comma-separated)']);
  });

  it('refuses ids that are not slugs', () => {
    expect(parseScouts('## A\nid: Big One\nrepos: acme/app\n\np\n').errors).toEqual(['line 2: id "Big One" must be lower-case letters, digits and single dashes']);
  });

  it('refuses two scouts with the same id', () => {
    const { scouts, errors } = parseScouts('## Ops watch\nrepos: acme/app\n\np\n## ops  watch!\nrepos: acme/app\n\nq\n');
    expect(scouts.map((scout) => scout.name)).toEqual(['Ops watch']);
    expect(errors).toEqual(['line 5: id "ops-watch" is already used by the scout on line 1; give one of them an id: line']);
  });

  it('lets an id line keep two alike names apart', () => {
    const { scouts, errors } = parseScouts('## Ops watch\nrepos: acme/app\n\np\n## ops watch\nid: ops-two\nrepos: acme/app\n\nq\n');
    expect(errors).toEqual([]);
    expect(scouts.map((scout) => scout.id)).toEqual(['ops-watch', 'ops-two']);
  });

  it('reads a plain */ as a path pattern, not the new-folder hint', () => {
    const { scouts } = parseScouts('## A\nrepos: acme/app\npaths: */\n\np\n');
    expect(scouts[0]!.paths[0]).toMatchObject({ pattern: '*/', addedOnly: false, newTopLevelFolder: false });
  });

  it('reads headings with a closing run of # and keeps a # that is part of the name', () => {
    const { scouts } = parseScouts('## Lookout ##\nrepos: acme/app\n\np\n## C# watch\nrepos: acme/app\n\nq\n');
    expect(scouts.map((scout) => scout.name)).toEqual(['Lookout', 'C# watch']);
  });

  it('stays fast on a heading or path entry with a long run of spaces', () => {
    const spaces = ' '.repeat(50_000);
    const started = performance.now();
    const parsed = parseScouts(`##${spaces}x${spaces}\nrepos: acme/app\npaths: src/**${spaces}(${spaces}\n\np\n`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(parsed.scouts[0]?.name).toBe('x');
  });
});

