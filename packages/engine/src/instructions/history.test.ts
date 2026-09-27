import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@code-manager/store';
import { describe, expect, it } from 'vitest';
import { InstructionsHistory } from './history.ts';

const NOW = new Date('2026-09-27T12:00:00Z');

function setup(initial: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-instructions-'));
  const file = join(dir, 'instructions.md');
  if (initial !== null) {
    writeFileSync(file, initial);
  }
  const store = Store.open(':memory:');
  return { dir, file, store, history: new InstructionsHistory(store, file, () => NOW) };
}

describe('InstructionsHistory', () => {
  it('has no version while there is no text', () => {
    const { history } = setup(null);
    expect(history.current()).toEqual({ text: '', version: null });
  });

  it('stores the text found on disk once, then hand edits as their own versions', () => {
    const { file, store, history } = setup('- I care about CI cost\n');

    expect(history.current().version).toMatchObject({ version: 1, origin: 'outside', summary: 'Found on disk' });
    expect(history.current().version?.version).toBe(1);

    writeFileSync(file, '- I care about CI cost\n- and cache keys\n');
    expect(history.current().version).toMatchObject({ version: 2, origin: 'outside', summary: 'Edited outside the app' });
    expect(store.instructions.list(10)).toHaveLength(2);
  });

  it('writes the file and stores a chat version on save', () => {
    const { file, history } = setup('a\n');
    history.current();

    const saved = history.save('a\nb\n', 'Added b', 12);

    expect(readFileSync(file, 'utf8')).toBe('a\nb\n');
    expect(saved).toMatchObject({ version: 2, origin: 'chat', sourceChatMessageId: 12, summary: 'Added b' });
    expect(history.current().version?.version).toBe(2);
  });

  it('writes through a symlink instead of replacing it', () => {
    const { dir } = setup(null);
    const target = join(dir, 'dotfiles-instructions.md');
    writeFileSync(target, 'a\n');
    const link = join(dir, 'linked.md');
    symlinkSync(target, link);
    const history = new InstructionsHistory(Store.open(':memory:'), link, () => NOW);

    history.save('a\nb\n', 'Added b', 1);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('a\nb\n');
  });
});
