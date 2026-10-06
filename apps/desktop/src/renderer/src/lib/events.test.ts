import { describe, expect, it } from 'vitest';
import { eventGlyph, splitActor, splitPath, summaryLead } from './events.ts';

describe('event helpers', () => {
  it('keeps the glyph set small: pushes share the commit glyph', () => {
    expect(eventGlyph('commits_pushed')).toBe('commit');
    expect(eventGlyph('commits_after_approval')).toBe('commit');
    expect(eventGlyph('force_pushed')).toBe('commit');
    expect(eventGlyph('question_to_user')).toBe('question');
    expect(eventGlyph('merged_without_review')).toBe('merge');
    expect(eventGlyph('bot_comment')).toBe('bot');
  });

  it('splits the actor off the summary', () => {
    expect(splitActor('rowan pushed 2 commits', 'rowan')).toEqual({ actor: 'rowan', rest: ' pushed 2 commits' });
    expect(splitActor('CI failed', 'ci-bot')).toBeNull();
  });

  it('keeps only the lead of a summary', () => {
    expect(summaryLead('lyra asked you: can you check: the migration?')).toBe('lyra asked you');
    expect(summaryLead('ada approved')).toBe('ada approved');
  });
});

describe('splitPath', () => {
  it('splits the file off the end of a thread line', () => {
    expect(splitPath(' replied to bob on src/a.ts', 'src/a.ts')).toEqual({ before: ' replied to bob on ', path: 'src/a.ts' });
  });

  it('leaves a line that does not end in the file alone', () => {
    expect(splitPath(' commented', 'src/a.ts')).toBeNull();
    expect(splitPath(' replied to bob on src/a.ts: ok', 'src/a.ts')).toBeNull();
    expect(splitPath(' replied', '')).toBeNull();
  });
});
