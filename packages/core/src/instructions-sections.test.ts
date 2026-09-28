import { describe, expect, it } from 'vitest';
import { changedHeadings, formatInstructionsSections, parseInstructionsSections, sectionChanges } from './instructions-sections.ts';

const FILE = `Intro line before any heading.

# About me
- I work on developer experience.

## What I care about
- CI cost.
- Cache keys.
`;

describe('parseInstructionsSections', () => {
  it('splits at level 1-3 headings and keeps the text before the first one', () => {
    expect(parseInstructionsSections(FILE)).toEqual([
      { heading: '', body: 'Intro line before any heading.' },
      { heading: 'About me', body: '- I work on developer experience.' },
      { heading: 'What I care about', body: '- CI cost.\n- Cache keys.' },
    ]);
  });

  it('reads an empty text as no sections, and a heading without text as an empty body', () => {
    expect(parseInstructionsSections('')).toEqual([]);
    expect(parseInstructionsSections('# Preferences\n')).toEqual([{ heading: 'Preferences', body: '' }]);
  });

  it('does not take a #hashtag or a deeper heading as a section', () => {
    expect(parseInstructionsSections('#nospace\n#### deep\ntext')).toEqual([{ heading: '', body: '#nospace\n#### deep\ntext' }]);
  });
});

describe('formatInstructionsSections', () => {
  it('writes "# heading", the body and one blank line between sections', () => {
    const text = formatInstructionsSections([
      { heading: 'About me', body: '- DevEx.\n' },
      { heading: 'Preferences', body: '  - Short.  ' },
    ]);
    expect(text).toBe('# About me\n- DevEx.\n\n# Preferences\n- Short.\n');
  });

  it('leaves out sections with no text and writes nothing for none', () => {
    expect(formatInstructionsSections([{ heading: 'Empty', body: ' ' }, { heading: '', body: 'Intro' }])).toBe('Intro\n');
    expect(formatInstructionsSections([])).toBe('');
  });

  it('reads back what it wrote', () => {
    const sections = [
      { heading: 'About me', body: '- DevEx.' },
      { heading: 'What I own', body: '- CI.\n- Builds.' },
    ];
    expect(parseInstructionsSections(formatInstructionsSections(sections))).toEqual(sections);
  });
});

describe('sectionChanges', () => {
  it('matches sections by heading and lists removed ones last', () => {
    const after = '# about me\n- I work on developer experience.\n\n# What I own\n- CI.\n\n# What I care about\n- CI cost only.\n';
    expect(sectionChanges(FILE, after)).toEqual([
      { heading: 'about me', change: 'same' },
      { heading: 'What I own', change: 'added' },
      { heading: 'What I care about', change: 'changed' },
      { heading: '', change: 'removed' },
    ]);
  });

  it('names only what moved', () => {
    expect(changedHeadings(FILE, FILE)).toEqual([]);
    expect(changedHeadings('', '# About me\n- x\n')).toEqual(['About me']);
    expect(changedHeadings('Intro\n', '')).toEqual(['(intro)']);
  });
});
