import { describe, expect, it } from 'vitest';
import type { SetupSectionEdit } from './setup.ts';
import { mapSetupFit, SETUP_FIT_LIMITS, type SetupFitAnswer } from './setup-fit.ts';

const sections: SetupSectionEdit[] = [
  { heading: 'What to ignore or keep quiet', body: '- Dependency bumps in acme/app' },
  {
    heading: 'Preferences',
    body: ['- Keep summaries short', "- Don't push unrelated write-ups onto PR branches", '- Ignore PRs from the docs bot', '- Be helpful'].join('\n'),
  },
];

function note(overrides: Partial<SetupFitAnswer['notes'][number]>): SetupFitAnswer['notes'][number] {
  return { heading: 'Preferences', line: '', kind: 'no_effect', why: 'PostPile never pushes.', moveTo: null, rewrite: null, ...overrides };
}

describe('mapSetupFit', () => {
  it('keeps a note on a line the text has, with the line and heading from the text', () => {
    const notes = mapSetupFit({ notes: [note({ heading: 'preferences', line: "don't push unrelated write-ups onto PR branches" })] }, sections);
    expect(notes).toEqual([
      {
        heading: 'Preferences',
        line: "Don't push unrelated write-ups onto PR branches",
        kind: 'no_effect',
        why: 'PostPile never pushes.',
        moveTo: null,
        rewrite: null,
      },
    ]);
  });

  it('finds a line under another heading than the one named, and drops lines the text lacks', () => {
    const notes = mapSetupFit(
      { notes: [note({ heading: 'About me', line: '- Keep summaries short', kind: 'unclear' }), note({ line: 'A line nobody wrote' })] },
      sections,
    );
    expect(notes.map((entry) => [entry.heading, entry.line])).toEqual([['Preferences', 'Keep summaries short']]);
  });

  it('keeps a move only to another known heading', () => {
    const answer: SetupFitAnswer = {
      notes: [
        note({ line: 'Ignore PRs from the docs bot', kind: 'wrong_section', moveTo: '# What to ignore or keep quiet' }),
        note({ line: 'Keep summaries short', kind: 'wrong_section', moveTo: 'Preferences' }),
        note({ line: 'Be helpful', kind: 'wrong_section', moveTo: 'Somewhere else' }),
      ],
    };
    expect(mapSetupFit(answer, sections).map((entry) => [entry.line, entry.moveTo])).toEqual([['Ignore PRs from the docs bot', 'What to ignore or keep quiet']]);
  });

  it('offers a move to a usual heading the text does not have yet', () => {
    const notes = mapSetupFit({ notes: [note({ line: 'Be helpful', kind: 'wrong_section', moveTo: 'about me' })] }, sections);
    expect(notes[0]?.moveTo).toBe('About me');
  });

  it('drops unknown kinds, a second note on the same line and rewrites that say the same', () => {
    const answer: SetupFitAnswer = {
      notes: [
        note({ line: 'Be helpful', kind: 'rude' }),
        note({ line: 'Be helpful', kind: 'unclear', rewrite: '- Lead every summary with what needs me' }),
        note({ line: 'Be helpful', kind: 'no_effect' }),
        note({ line: 'Keep summaries short', kind: 'unclear', rewrite: 'keep summaries short' }),
      ],
    };
    expect(mapSetupFit(answer, sections).map((entry) => [entry.line, entry.kind, entry.rewrite])).toEqual([
      ['Be helpful', 'unclear', 'Lead every summary with what needs me'],
      ['Keep summaries short', 'unclear', null],
    ]);
  });

  it('stops at the note limit', () => {
    const many = Array.from({ length: SETUP_FIT_LIMITS.notes + 3 }, (_, index) => `- Line ${index}`);
    const notes = mapSetupFit({ notes: many.map((line) => note({ line })) }, [{ heading: 'Preferences', body: many.join('\n') }]);
    expect(notes).toHaveLength(SETUP_FIT_LIMITS.notes);
  });
});
