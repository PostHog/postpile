import { describe, expect, it } from 'vitest';
import { editedInstructionsSummary } from './instructions-summary.ts';

const BASE = '# Reviews\nFlag cache keys.\n';

describe('editedInstructionsSummary', () => {
  it('names the line the user wrote, not the proposed one', () => {
    expect(editedInstructionsSummary(BASE, `${BASE}Flag any PR that lands without my review.\n`)).toBe('Added: Flag any PR that lands without my review. (your wording)');
  });

  it('names a removed line', () => {
    expect(editedInstructionsSummary(BASE, '# Reviews\n')).toBe('Removed: Flag cache keys. (your edit)');
  });

  it('names a changed line', () => {
    expect(editedInstructionsSummary(BASE, '# Reviews\nFlag cache keys and runner labels.\n')).toBe('Changed to: Flag cache keys and runner labels. (your wording)');
  });

  it('counts bigger edits', () => {
    expect(editedInstructionsSummary(BASE, '# Reviews\nOne.\nTwo.\n')).toBe('Your edit: 2 lines added, 1 removed');
  });

  it('cuts a long line', () => {
    const summary = editedInstructionsSummary('', `${'x'.repeat(200)}\n`);
    expect(summary.length).toBeLessThan(120);
    expect(summary).toContain('…');
  });
});
