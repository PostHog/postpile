// The Scouts intro card on sample data (fake-scout-intro.ts): it shows until
// answered, the draft and the check are canned, Turn on adds an empty scout.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';
import { FAKE_SCOUT_DRAFT } from './fake-scout-intro.ts';

function engine(): FakeEngine {
  return new FakeEngine({ now: () => new Date('2026-09-29T12:00:00Z'), setupStepMs: 0 });
}

describe('FakeEngine scouts intro', () => {
  it('opens by itself with acme/app as the main repo until Not now', async () => {
    const fake = engine();
    const state = await fake.scoutIntroState();
    expect(state).toMatchObject({ autoShow: true, mainRepo: 'acme/app' });
    expect(state.repos.length).toBeGreaterThan(1);
    expect((await fake.dismissScoutIntro()).ok).toBe(true);
    expect((await fake.scoutIntroState()).autoShow).toBe(false);
  });

  it('drafts, then checks with one part a scout cannot see, whose rewrite checks clean', async () => {
    const fake = engine();
    expect(await fake.draftScout()).toEqual({ text: FAKE_SCOUT_DRAFT, why: 'drafted' });
    const checked = await fake.checkScout({ prompt: FAKE_SCOUT_DRAFT, repos: ['acme/app'] });
    expect(checked).toMatchObject({ ok: true, fit: { verdict: 'fits' }, name: 'Lookout · structure', paths: ['+*/'] });
    expect(checked.trial).toMatchObject({ days: 2, pulled: 5, complete: true });
    expect(checked.trial?.examples.map((example) => example.prKey)).toEqual(['acme/app#2701', 'acme/app#2688']);
    const rewrite = checked.cantSee?.rewrite ?? '';
    expect(rewrite).toBe(FAKE_SCOUT_DRAFT.replace(' models shared across module boundaries,', ''));
    expect((await fake.checkScout({ prompt: rewrite, repos: ['acme/app'] })).cantSee).toBeNull();
  });

  it('turns a scout on: an empty row last in the Scouted section, the engine toast, the card answered', async () => {
    const fake = engine();
    const result = await fake.turnOnScout({ name: 'Lookout · api', prompt: FAKE_SCOUT_DRAFT, repos: ['acme/app'], paths: ['+*/'] });
    expect(result).toEqual({ ok: true, message: 'Scout on: Lookout · api. Finds show under Scouted after the next sync.', undoToken: null });
    expect((await fake.listScouts()).at(-1)).toMatchObject({ name: 'Lookout · api', tiles: 0, unseen: 0 });
    expect((await fake.scoutIntroState()).autoShow).toBe(false);
  });
});
