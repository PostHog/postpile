import { describe, expect, it } from 'vitest';
import { externalLinkProblem, isAppPage } from './app-page.ts';

const file = '/Applications/PostPile.app/Contents/Resources/app/out/renderer/index.html';

describe('isAppPage', () => {
  it('accepts the bundled page, with or without query and hash', () => {
    expect(isAppPage(`file://${file}`, file, undefined)).toBe(true);
    expect(isAppPage(`file://${file}?x=1#top`, file, undefined)).toBe(true);
  });

  it('refuses other files and web pages', () => {
    expect(isAppPage('file:///tmp/evil.html', file, undefined)).toBe(false);
    expect(isAppPage('https://evil.example/', file, undefined)).toBe(false);
    expect(isAppPage('not a url', file, undefined)).toBe(false);
  });

  it('accepts the dev server origin only in a dev run', () => {
    expect(isAppPage('http://localhost:5173/index.html', file, 'http://localhost:5173')).toBe(true);
    expect(isAppPage('http://localhost:5174/', file, 'http://localhost:5173')).toBe(false);
  });
});

describe('externalLinkProblem', () => {
  it('lets https through and names why anything else is dropped', () => {
    expect(externalLinkProblem('https://github.com/acme/app/pull/1')).toBeNull();
    expect(externalLinkProblem('file:///etc/passwd')).toBe('scheme file: is not allowed');
    expect(externalLinkProblem('javascript:alert(1)')).toBe('scheme javascript: is not allowed');
    expect(externalLinkProblem('::nope')).toBe('not a valid URL');
  });
});
