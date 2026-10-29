import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { ScoutsHistory } from './history.ts';

const NOW = new Date('2026-10-29T12:00:00Z');
const VALID = '## Lookout\nrepos: acme/app\n\nNew services.\n';

function setup(initial: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'pp-scouts-'));
  const file = join(dir, 'scouts.md');
  if (initial !== null) {
    writeFileSync(file, initial);
  }
  const store = Store.open(':memory:');
  return { file, store, history: new ScoutsHistory(store, file, () => NOW) };
}

describe('ScoutsHistory', () => {
  it('has no scouts and no version without a file', () => {
    const { history, store } = setup(null);
    expect(history.active()).toEqual({ scouts: [], version: null, errors: [] });
    expect(store.scoutsVersions.latest()).toBeNull();
  });

  it('stores the text found on disk once, then hand edits as their own versions', () => {
    const { file, store, history } = setup(VALID);

    expect(history.active().version).toMatchObject({ version: 1, origin: 'outside', summary: 'Found on disk' });
    expect(history.active().version?.version).toBe(1);

    writeFileSync(file, `${VALID}\n## Billing\nrepos: acme/billing\n\nInvoices.\n`);
    const active = history.active();
    expect(active.version).toMatchObject({ version: 2, summary: 'Edited outside the app' });
    expect(active.scouts.map((scout) => scout.id)).toEqual(['lookout', 'billing']);
    expect(store.scoutsVersions.list(10)).toHaveLength(2);
  });

  it('keeps the last valid version in force while the file does not parse, and stores the broken edit', () => {
    const { file, store, history } = setup(VALID);
    history.active();

    writeFileSync(file, '## Lookout\nrepos: nope\n\nNew services.\n');
    const active = history.active();

    expect(active.errors).toEqual(['line 2: repo "nope" is not owner/name']);
    expect(active.version?.version).toBe(1);
    expect(active.scouts.map((scout) => scout.id)).toEqual(['lookout']);
    expect(store.scoutsVersions.latest()?.version).toBe(2);
  });

  it('has no scouts when no version ever parsed', () => {
    const { history } = setup('## Lookout\n\nno repos\n');
    expect(history.active()).toMatchObject({ scouts: [], version: null, errors: ['line 1: "Lookout" needs a repos: line (owner/name, comma-separated)'] });
  });

  it('turns every scout off when the file is emptied', () => {
    const { file, history } = setup(VALID);
    history.active();
    writeFileSync(file, '');
    expect(history.active()).toMatchObject({ scouts: [], errors: [], version: { version: 2 } });
  });

  it('stores nothing when read-only', () => {
    const { file, store } = setup(VALID);
    const history = new ScoutsHistory(store, file, () => NOW, true);
    expect(history.active()).toMatchObject({ scouts: [{ id: 'lookout' }], version: null, errors: [] });
    expect(store.scoutsVersions.latest()).toBeNull();
  });
});
