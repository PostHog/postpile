import { describe, expect, it } from 'vitest';
import { stripHtmlComments } from './html-comments.ts';

describe('stripHtmlComments', () => {
  it('removes closed comments and hides the rest after an unclosed one', () => {
    expect(stripHtmlComments('a<!-- x -->b<!-- y -->c')).toBe('abc');
    expect(stripHtmlComments('a<!-- open')).toBe('a');
    expect(stripHtmlComments('plain')).toBe('plain');
  });

  it('stays fast on many unclosed openers', () => {
    const text = '<!--'.repeat(50_000);
    const started = Date.now();
    expect(stripHtmlComments(text)).toBe('');
    expect(Date.now() - started).toBeLessThan(500);
  });
});
