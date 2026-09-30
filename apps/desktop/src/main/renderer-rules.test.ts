import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Core ships display decisions, the renderer only displays them (DESIGN.md
// "Rules layer: one home per fact", "Groups inside a topic"). Whether a tile
// is unread, dealt with or gets the NEW pill comes from core as
// `TileView.group` and `TileView.newBadge`. This test fails when renderer
// code works one of them out from the raw tile state again. It is a plain
// text search: a false hit means the line reads like a rule, so reword it or
// move the rule to core.
const renderer = join(import.meta.dirname, '../renderer/src');

// `allowedIn`: lib/optimistic.ts guesses the state a click leaves until the
// refetch brings core's answer (DESIGN "Groups inside a topic"), so it may
// read the snoozed tile's unread thread flag.
const FORBIDDEN: { pattern: RegExp; instead: string; allowedIn?: string }[] = [
  { pattern: /\.kind\s*[!=]==?\s*['"](unread|done)['"]/, instead: 'TileView.group' },
  { pattern: /['"](unread|done)['"]\s*[!=]==?\s*[\w.?]*\.kind\b/, instead: 'TileView.group' },
  { pattern: /\.unreadOnGitHub\b/, instead: 'TileView.group or TileView.unreadPrKeys', allowedIn: 'lib/optimistic.ts' },
  { pattern: /\.automation\b/, instead: 'TileView.newBadge' },
];

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('renderer rules stay in core', () => {
  it('finds renderer source to check', () => {
    expect(sourceFiles(renderer).length).toBeGreaterThan(50);
  });

  it('no renderer code works out unread, dealt with or the NEW pill from raw tile state', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(renderer)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const { pattern, instead, allowedIn } of FORBIDDEN) {
            if (pattern.test(line) && relative(renderer, file) !== allowedIn) {
              hits.push(`${relative(renderer, file)}:${index + 1}: use ${instead} (${line.trim()})`);
            }
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
