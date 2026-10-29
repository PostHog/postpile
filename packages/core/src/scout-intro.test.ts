import { describe, expect, it } from 'vitest';
import { appendScout, mapScoutCheck, scoutIntroAutoShows, scoutSection, trialRateWords } from './scout-intro.ts';
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
    cantSee: { part: 'models used across services', why: 'That hides in the code.', rewrite: 'PRs that add a new top-level folder or service. Skip fixes inside one service.' },
    name: '  Lookout  ·  structure ',
    paths: ['+*/', 'services/*/api/**', '!secret/**', 'a,b'],
  };

  it('keeps a part it quotes from the prompt, and path hints that parse', () => {
    expect(mapScoutCheck(answer, PROMPT)).toEqual({
      fit: { verdict: 'fits', note: 'New folders show in changed paths.' },
      cantSee: answer.cantSee,
      name: 'Lookout · structure',
      paths: ['+*/', 'services/*/api/**'],
    });
  });

  it('drops a part the prompt does not say, or a rewrite that drops nothing', () => {
    expect(mapScoutCheck({ ...answer, cantSee: { ...answer.cantSee, part: 'billing tables' } }, PROMPT).cantSee).toBeNull();
    expect(mapScoutCheck({ ...answer, cantSee: { ...answer.cantSee, rewrite: PROMPT } }, PROMPT).cantSee).toBeNull();
  });

  it('reads an unknown verdict as partly and an empty name as a plain default', () => {
    expect(mapScoutCheck({ ...answer, fit: 'great', name: '' }, PROMPT)).toMatchObject({ fit: { verdict: 'partly' }, name: 'My scout' });
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

  it('refuses a file that does not parse, a duplicate name, and a prompt that would not read back', () => {
    expect(appendScout('## A\nrepos: nope\n\nx\n', scout)).toMatchObject({ error: expect.stringContaining('does not parse') });
    expect(appendScout(scoutSection(scout), scout)).toMatchObject({ error: expect.stringContaining('already used') });
    expect(appendScout('', { ...scout, prompt: 'repos: acme/web\nlook here' })).toHaveProperty('error');
  });
});
