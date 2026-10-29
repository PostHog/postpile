import { describe, expect, it } from 'vitest';
import {
  appendScout,
  cleanScoutLabels,
  isScoutPathHint,
  mapScoutCheck,
  mapScoutRefine,
  scoutWantsAfter,
  SCOUT_LABEL_WHY_MAX,
  SCOUT_REFINE_PATHS,
  promptWithoutPart, scoutFromCard, scoutIntroAutoShows, scoutNameWithId, SCOUT_NAME_MAX, scoutSection, trialRateWords } from './scout-intro.ts';
import { parseScouts, scoutSlug } from './scouts-config.ts';

const PROMPT = 'PRs that add a new top-level folder or service, or models used across services. Skip fixes inside one service.';

describe('scoutIntroAutoShows', () => {
  it('opens by itself only without scouts and before any Not now', () => {
    expect(scoutIntroAutoShows({ dismissedAt: null, scouts: 0 })).toBe(true);
    expect(scoutIntroAutoShows({ dismissedAt: '2026-10-29T10:00:00Z', scouts: 0 })).toBe(false);
    expect(scoutIntroAutoShows({ dismissedAt: null, scouts: 1 })).toBe(false);
  });
});

describe('mapScoutCheck', () => {
  const answer = {
    fit: 'fits',
    note: 'New folders show in changed paths.',
    cantSee: { part: 'or models used across services', why: 'That hides in the code.' },
    name: '  Lookout  ·  structure ',
    paths: ['+*/', 'services/*/api/**'],
    pathsCoverAll: true,
  };

  it('keeps a part it quotes from the prompt, cut from the prompt itself, and path hints that cover it all', () => {
    expect(mapScoutCheck(answer, PROMPT)).toEqual({
      fit: { verdict: 'fits', note: 'New folders show in changed paths.' },
      cantSee: { ...answer.cantSee, rewrite: 'PRs that add a new top-level folder or service. Skip fixes inside one service.' },
      name: 'Lookout · structure',
      paths: ['+*/', 'services/*/api/**'],
    });
  });

  it('keeps no path hints unless they cover the whole prompt and scouts.md can hold every one', () => {
    expect(mapScoutCheck({ ...answer, pathsCoverAll: false }, PROMPT).paths).toEqual([]);
    for (const bad of ['!secret/**', 'a,b', `src/${'a'.repeat(200)}`, 'src/**\nid: billing', 'docs (the old ones)']) {
      expect(mapScoutCheck({ ...answer, paths: ['+*/', bad] }, PROMPT).paths).toEqual([]);
    }
  });

  it('drops a part the prompt does not say, and offers no cut for one it says only loosely', () => {
    expect(mapScoutCheck({ ...answer, cantSee: { ...answer.cantSee, part: 'billing tables' } }, PROMPT).cantSee).toBeNull();
    // Case and spacing differ: the part is shown, but nothing is cut.
    expect(mapScoutCheck({ ...answer, cantSee: { ...answer.cantSee, part: 'Or  models used across services' } }, PROMPT).cantSee).toMatchObject({ rewrite: null });
  });

  it('reads an unknown verdict as partly and an empty name as a plain default', () => {
    expect(mapScoutCheck({ ...answer, fit: 'great', name: '' }, PROMPT)).toMatchObject({ fit: { verdict: 'partly' }, name: 'My scout' });
  });
});

describe('scoutNameWithId', () => {
  it('keeps a name that slugs, falls back for one that does not, and steps past ids in use', () => {
    expect(scoutNameWithId('Lookout', ['acme/app'], new Set())).toBe('Lookout');
    expect(scoutNameWithId('结构哨兵', ['acme/app'], new Set())).toBe('Scout app');
    expect(scoutNameWithId('Lookout', ['acme/app'], new Set(['lookout', 'lookout-2']))).toBe('Lookout 3');
    expect(scoutNameWithId('结构哨兵', ['acme/app'], new Set(['scout-app']))).toBe('Scout app 2');
  });

  it('keeps a fallback within the Turn on limit, the step suffix included', () => {
    const repo = `acme/${'x'.repeat(100)}`;
    const first = scoutNameWithId('结构哨兵', [repo], new Set());
    expect(first).toHaveLength(SCOUT_NAME_MAX);
    const second = scoutNameWithId('结构哨兵', [repo], new Set([scoutSlug(first)]));
    expect(second).toHaveLength(SCOUT_NAME_MAX);
    expect(second.endsWith(' 2')).toBe(true);
  });
});

describe('promptWithoutPart', () => {
  it('cuts the part word for word and tidies the punctuation around it', () => {
    expect(promptWithoutPart('New folders, models used across services, or API shape.', 'models used across services')).toBe('New folders, or API shape.');
    expect(promptWithoutPart('New folders, and models used across services.', 'and models used across services')).toBe('New folders.');
    expect(promptWithoutPart('Models used across services, and new folders.', 'Models used across services')).toBe('And new folders.');
    expect(promptWithoutPart('New folders (models used across services).', 'models used across services')).toBe('New folders.');
    expect(promptWithoutPart('New folders. Also models.\nSkip fixes.', 'Also models.')).toBe('New folders.\nSkip fixes.');
  });

  it('cuts nothing when the part is not there as written, or is all there is', () => {
    expect(promptWithoutPart('New folders, or API shape.', 'models')).toBeNull();
    expect(promptWithoutPart('New folders.', 'new folders')).toBeNull();
    expect(promptWithoutPart('New folders.', 'New folders.')).toBeNull();
  });
});

describe('isScoutPathHint', () => {
  it('takes path globs and refuses long, multi-line, comma, spaced or unsupported ones', () => {
    expect(['+*/', '+products/*/', 'docs/architecture.md', 'services/*/api/**', '+billing/'].every(isScoutPathHint)).toBe(true);
    // At most 4 globstars (and 8 stars in all).
    expect(isScoutPathHint('a/**/b/**/c/**/d/**/e')).toBe(true);
    expect(isScoutPathHint('a/**/b/**/c/**/d/**/e/**/f')).toBe(false);
    expect([`src/${'a'.repeat(200)}`, 'src/**\nid: billing', 'a,b', 'docs (old)', '!secret/**', '', 'src/[ab]', `${'a*'.repeat(20)}b`].some(isScoutPathHint)).toBe(false);
  });
});

describe('trialRateWords', () => {
  it('says the rate in plain words', () => {
    expect(trialRateWords(0, 2)).toBe('none');
    expect(trialRateWords(1, 2)).toBe('fewer than 1 a day');
    expect(trialRateWords(4, 2)).toBe('about 2 a day');
    expect(trialRateWords(5, 2)).toBe('about 2–3 a day');
  });
});

describe('appendScout', () => {
  const scout = { name: 'Lookout · structure', prompt: PROMPT, repos: ['acme/app'], paths: ['+*/'] };

  it('writes a section that parses back as asked, after what the file holds', () => {
    const existing = '## Billing\nrepos: acme/billing\n\nInvoices.\n';
    const result = appendScout(existing, scout);
    expect('text' in result && result.text).toBe(`${existing}\n${scoutSection(scout)}`);
    const parsed = parseScouts('text' in result ? result.text : '');
    expect(parsed.scouts.map((entry) => entry.id)).toEqual(['billing', 'lookout-structure']);
    expect(parsed.scouts[1]).toMatchObject({ repos: ['acme/app'], prompt: PROMPT });
  });

  it('gives the dry run the scout Turn on would write, or why it would not', () => {
    expect(scoutFromCard(scout)).toMatchObject({ config: { id: 'lookout-structure', repos: ['acme/app'], prompt: PROMPT } });
    // A prompt line that reads as a key would widen the repos: refused, like Turn on.
    expect(scoutFromCard({ ...scout, prompt: 'repos: acme/other\nFind billing changes.' })).toHaveProperty('error');
  });

  it('starts an empty file with the section alone', () => {
    expect(appendScout('', scout)).toEqual({ text: scoutSection(scout) });
  });

  it('never writes a hint that would add a key line, and refuses to append one', () => {
    const sneaky = { ...scout, paths: ['src/**\nid: billing'] };
    expect(scoutSection(sneaky)).not.toContain('id:');
    expect(appendScout('## Billing\nrepos: acme/billing\n\nInvoices.\n', sneaky)).toMatchObject({ error: expect.stringContaining('not a path hint') });
    expect(appendScout('', { ...scout, paths: [`src/${'a'.repeat(200)}`] })).toHaveProperty('error');
  });

  it('refuses a file that does not parse, a duplicate name, and a prompt that would not read back', () => {
    expect(appendScout('## A\nrepos: nope\n\nx\n', scout)).toMatchObject({ error: expect.stringContaining('does not parse') });
    expect(appendScout(scoutSection(scout), scout)).toMatchObject({ error: expect.stringContaining('already used') });
    expect(appendScout('', { ...scout, prompt: 'repos: acme/web\nlook here' })).toHaveProperty('error');
  });
});

describe('mapScoutRefine', () => {
  const current = { prompt: PROMPT, paths: ['+*/', 'services/**'] };

  it('takes the revised prompt, the valid hints and the summary', () => {
    const refined = mapScoutRefine({ prompt: ' Skip fixes. Pull new services. ', paths: ['+*/', ' services/*/api/** '], summary: 'Added a skip rule.\n Narrowed services.' }, current);
    expect(refined).toEqual({ prompt: 'Skip fixes. Pull new services.', paths: ['+*/', 'services/*/api/**'], summary: 'Added a skip rule. Narrowed services.', droppedHints: 0 });
  });

  it('drops hints scouts.md could not hold and counts them, never writing one', () => {
    const refined = mapScoutRefine({ prompt: PROMPT, paths: ['+*/', 'a b', 'x, y', 'docs/**\nid: other', 42, '**/**/**/**/**/x'], summary: '' }, current);
    expect(refined.paths).toEqual(['+*/']);
    expect(refined.droppedHints).toBe(5);
  });

  it('keeps the current hints when the answer has no list of them; only an explicit empty list turns the filter off', () => {
    expect(mapScoutRefine({ prompt: PROMPT, paths: undefined, summary: '' }, current)).toMatchObject({ paths: current.paths, droppedHints: 0 });
  });

  it('keeps the current hints when every suggested one is invalid, and turns the filter off only on an empty list', () => {
    expect(mapScoutRefine({ prompt: PROMPT, paths: ['not a hint'], summary: '' }, current).paths).toEqual(current.paths);
    expect(mapScoutRefine({ prompt: PROMPT, paths: [], summary: '' }, current).paths).toEqual([]);
  });

  it('keeps the current prompt when the answer has none, and caps the hints', () => {
    const many = Array.from({ length: SCOUT_REFINE_PATHS + 3 }, (_, index) => `dir${index}/**`);
    const refined = mapScoutRefine({ prompt: '  ', paths: many, summary: 'x' }, current);
    expect(refined.prompt).toBe(PROMPT);
    expect(refined.paths).toHaveLength(SCOUT_REFINE_PATHS);
  });
});

describe('cleanScoutLabels', () => {
  it('keeps one label per PR, the last one, with the note on one clipped line', () => {
    const labels = cleanScoutLabels([
      { prKey: 'acme/app#1', label: 'want', why: 'x' },
      { prKey: 'acme/app#1', label: 'noise', why: ' just\n a fix ' },
      { prKey: 'acme/app#2', label: 'maybe' as 'want', why: '' },
      { prKey: 'acme/app#3', label: 'want', why: 'y'.repeat(SCOUT_LABEL_WHY_MAX + 50) },
    ]);
    expect(labels.map((entry) => [entry.prKey, entry.label])).toEqual([
      ['acme/app#1', 'noise'],
      ['acme/app#3', 'want'],
    ]);
    expect(labels[0]!.why).toBe('just a fix');
    expect(labels[1]!.why.length).toBe(SCOUT_LABEL_WHY_MAX);
  });
});

describe('scoutWantsAfter', () => {
  const labels = [
    { prKey: 'acme/app#1', label: 'want' as const, why: '' },
    { prKey: 'acme/app#2', label: 'want' as const, why: '' },
    { prKey: 'acme/app#3', label: 'noise' as const, why: '' },
    { prKey: 'acme/app#4', label: 'want' as const, why: 'should have pulled' },
    { prKey: 'acme/app#5', label: 'want' as const, why: '' },
  ];

  it('calls a want lost only when the re-run judged it and skipped it; one it never judged is unchecked', () => {
    const before = new Set(['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#5']);
    // #1 judged and skipped: lost. #2 still pulled. #3 is noise. #4 a near miss, judged, still skipped: not lost. #5 never judged: unchecked.
    const after = { pulled: new Set(['acme/app#2']), judged: new Set(['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#4']) };
    expect(scoutWantsAfter(labels, before, after)).toEqual({ lost: ['acme/app#1'], unchecked: ['acme/app#5'] });
  });
});
