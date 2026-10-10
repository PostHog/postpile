/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

function animationToken(name: string): string {
  const line = css.split('\n').find((candidate: string) => candidate.trim().startsWith(`--animate-${name}:`));
  if (!line) {
    throw new Error(`--animate-${name} not found`);
  }
  return line;
}

describe('settle animations', () => {
  // A finished `both` animation on opacity/translate keeps a stacking context on the element,
  // which traps the tile menu (z-20) inside the footer so the next tile paints over it.
  it('the entering footer and word do not fill forwards', () => {
    for (const name of ['footer-in', 'word-in']) {
      expect(animationToken(name)).toContain('backwards');
      expect(animationToken(name)).not.toContain('both');
    }
  });
});
