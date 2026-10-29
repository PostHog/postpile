import { describe, expect, it } from 'vitest';
import { appendScout, isScoutPathHint, mapScoutCheck, promptWithoutPart, scoutIntroAutoShows, scoutSection, trialRateWords } from './scout-intro.ts';
import { parseScouts } from './scouts-config.ts';

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
    paths: ['+*/', 'services/*/api/**', '!secret/**', 'a,b', `src/${'a'.repeat(200)}`, 'src/**\nid: billing', 'docs (the old ones)'],
  };

  it('keeps a part it quotes from the prompt, cut from the prompt itself, and only path hints scouts.md can hold', () => {
    expect(mapScoutCheck(answer, PROMPT)).toEqual({
      fit: { verdict: 'fits', note: 'New folders show in changed paths.' },
      cantSee: { ...answer.cantSee, rewrite: 'PRs that add a new top-level folder or service. Skip fixes inside one service.' },
      name: 'Lookout · structure',
      paths: ['+*/', 'services/*/api/**'],
    });
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
    expect(['+*/', 'docs/architecture.md', 'services/*/api/**', '+billing/'].every(isScoutPathHint)).toBe(true);
    expect([`src/${'a'.repeat(200)}`, 'src/**\nid: billing', 'a,b', 'docs (old)', '!secret/**', '', 'src/[ab]'].some(isScoutPathHint)).toBe(false);
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
