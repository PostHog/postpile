import { describe, expect, it } from 'vitest';
import { eventGlyph, splitActor, summaryLead } from './events.ts';

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
