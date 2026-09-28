// instructions.md as sections: a heading line ("# About me", "## Preferences")
// and the text under it. The setup flow edits and compares the file per
// section; the file itself stays plain Markdown the user can edit by hand.

export interface InstructionsSection {
  /** The heading without its "#" marks. '' for text before the first heading. */
  heading: string;
  /** The text under the heading, trimmed. */
  body: string;
}

const HEADING = /^#{1,3}\s+(.+?)\s*#*\s*$/;

/** Splits the text at every level 1-3 heading. Text before the first heading becomes a section with heading ''. */
export function parseInstructionsSections(text: string): InstructionsSection[] {
  const sections: InstructionsSection[] = [];
  let heading = '';
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join('\n').trim();
    if (heading !== '' || body !== '') {
      sections.push({ heading, body });
    }
  };
  for (const line of text.split('\n')) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      heading = match[1]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * The sections as one Markdown text: "# heading", the body, a blank line
 * between sections and one newline at the end. Sections with an empty body
 * are left out, so an unused section in a draft does not write an empty heading.
 */
export function formatInstructionsSections(sections: InstructionsSection[]): string {
  const parts = sections
    .map((section) => ({ heading: section.heading.trim(), body: section.body.trim() }))
    .filter((section) => section.body !== '')
    .map((section) => (section.heading === '' ? section.body : `# ${section.heading}\n${section.body}`));
  return parts.length === 0 ? '' : `${parts.join('\n\n')}\n`;
}

export type SectionChangeKind = 'added' | 'changed' | 'removed' | 'same';

export interface SectionChange {
  heading: string;
  change: SectionChangeKind;
}

function headingKey(heading: string): string {
  return heading.trim().toLowerCase();
}

/**
 * Per section, what changed from `before` to `after`, matched by heading
 * (case does not matter). Sections of `after` come first in their order,
 * then the ones only `before` had. Whitespace-only differences count as same.
 */
export function sectionChanges(before: string, after: string): SectionChange[] {
  const old = new Map(parseInstructionsSections(before).map((section) => [headingKey(section.heading), section]));
  const seen = new Set<string>();
  const result: SectionChange[] = [];
  for (const section of parseInstructionsSections(after)) {
    const key = headingKey(section.heading);
    seen.add(key);
    const previous = old.get(key);
    if (!previous) {
      result.push({ heading: section.heading, change: 'added' });
    } else {
      result.push({ heading: section.heading, change: previous.body === section.body ? 'same' : 'changed' });
    }
  }
  for (const [key, section] of old) {
    if (!seen.has(key)) {
      result.push({ heading: section.heading, change: 'removed' });
    }
  }
  return result;
}

/** Headings that were added, changed or removed, for "Changed: About me, Preferences". */
export function changedHeadings(before: string, after: string): string[] {
  return sectionChanges(before, after)
    .filter((entry) => entry.change !== 'same')
    .map((entry) => entry.heading || '(intro)');
}
