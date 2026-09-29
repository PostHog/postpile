import { describe, expect, it } from 'vitest';
import { cleanPrBody, safeLinkUrl } from './markdown.ts';

describe('cleanPrBody', () => {
  it('drops HTML comments from PR templates, also multi-line and unclosed ones', () => {
    expect(cleanPrBody('<!-- Thanks! -->\n## Problem\n\nSlow CI.\n<!--\nhidden\n-->')).toBe('## Problem\n\nSlow CI.');
    expect(cleanPrBody('Text\n<!-- never closed')).toBe('Text');
  });

  it('squeezes blank lines and reads a template-only body as empty', () => {
    expect(cleanPrBody('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
    expect(cleanPrBody('  <!-- describe your change -->  \n\n')).toBe('');
  });
});

describe('safeLinkUrl', () => {
  it('keeps absolute web and mail links', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLinkUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
  });

  it('drops scripts, data and relative links', () => {
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(safeLinkUrl('data:text/html,hi')).toBeNull();
    expect(safeLinkUrl('docs/setup.md')).toBeNull();
  });
});
