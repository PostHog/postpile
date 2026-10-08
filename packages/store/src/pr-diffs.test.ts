// Line ranges per open PR (migration 037, DESIGN.md "Overlapping edits").
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePr } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './index.ts';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-diffs-'));
  store = Store.open(join(dir, 'db.sqlite'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = '2026-10-08T10:00:00.000Z';

function diff(headOid: string, capped = false) {
  return { headOid, baseRef: 'master', capped, fetchedAt: NOW, files: [{ path: 'ci.yml', ranges: [{ start: 600, end: 640 }] }] };
}

describe('PrDiffRepo', () => {
  it('wants a diff for open PRs that share a repo and base, and not for a lone one', () => {
    store.prs.upsert(makePr({ number: 1, headOid: 'a' }), NOW);
    expect(store.prDiffs.openWithoutCurrentDiff()).toEqual([]);

    store.prs.upsert(makePr({ number: 2, headOid: 'b' }), NOW);
    expect(store.prDiffs.openWithoutCurrentDiff().map((wanted) => wanted.key).sort()).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('stops wanting a PR once its diff is read, and wants it again after a push', () => {
    store.prs.upsert(makePr({ number: 1, headOid: 'a' }), NOW);
    store.prs.upsert(makePr({ number: 2, headOid: 'b' }), NOW);
    store.prDiffs.replace('acme/app#1', diff('a'));
    expect(store.prDiffs.openWithoutCurrentDiff().map((wanted) => wanted.key)).toEqual(['acme/app#2']);

    store.prs.upsert(makePr({ number: 1, headOid: 'pushed' }), NOW);
    expect(store.prDiffs.openWithoutCurrentDiff().map((wanted) => wanted.key).sort()).toEqual(['acme/app#1', 'acme/app#2']);
    // The old ranges belong to the old head: not used.
    expect(store.prDiffs.listOpenEdits()).toEqual([]);
  });

  it('lists the ranges of open PRs with a current diff, and replaces them as a whole', () => {
    store.prs.upsert(makePr({ number: 1, headOid: 'a' }), NOW);
    store.prDiffs.replace('acme/app#1', diff('a', true));
    expect(store.prDiffs.listOpenEdits()).toEqual([
      { prKey: 'acme/app#1', repo: 'acme/app', baseRef: 'master', capped: true, files: [{ path: 'ci.yml', ranges: [{ start: 600, end: 640 }] }] },
    ]);

    store.prDiffs.replace('acme/app#1', { ...diff('a'), files: [] });
    expect(store.prDiffs.listOpenEdits()).toEqual([{ prKey: 'acme/app#1', repo: 'acme/app', baseRef: 'master', capped: false, files: [] }]);
    expect(store.db.prepare('SELECT count(*) AS n FROM pr_hunk').get()).toEqual({ n: 0 });
  });

  it('leaves merged PRs out', () => {
    store.prs.upsert(makePr({ number: 1, headOid: 'a', state: 'MERGED' }), NOW);
    store.prDiffs.replace('acme/app#1', diff('a'));
    expect(store.prDiffs.listOpenEdits()).toEqual([]);
  });
});
