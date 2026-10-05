// What cutting bot bodies on save needs from the store (DESIGN.md "Bot
// bodies are cut when saved"): a machine comment's event keeps its state
// when its kind changes, a job can walk every snapshot, and the WAL can be
// emptied without waiting.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrEvent } from '@postpile/core';
import { at, makeEvent, makePr } from '@postpile/core/fixtures';
import { Store } from './index.ts';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-rewrite-'));
  store = Store.open(join(dir, 'db.sqlite'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const PR = 'acme/app#1';

function machine(kind: 'deploy' | 'bot_comment', sourceId = 'c1', overrides: Partial<PrEvent> = {}): PrEvent {
  return makeEvent({ id: `${PR}:${kind}:${sourceId}`, prKey: PR, kind, sourceId, actor: 'github-actions[bot]', isBot: true, at: at(10), ...overrides });
}

function logged(): Array<[number, string]> {
  return store.db.prepare('SELECT seq, event_id FROM event_log ORDER BY seq').all().map((row) => [row.seq as number, row.event_id as string]);
}

describe('EventRepo.upsertDerived: a machine comment changing kind', () => {
  it('keeps the event under its new id with its seen time, override and log seq, and reports nothing new', () => {
    const other = makeEvent({ id: `${PR}:comment:c2`, prKey: PR, sourceId: 'c2' });
    store.events.upsertDerived(PR, [machine('deploy'), other]);
    store.eventLog.append([{ id: machine('deploy').id, prKey: PR }, { id: other.id, prKey: PR }], at(11));
    store.events.markSeen([machine('deploy').id], at(20));
    store.events.setOverride(machine('deploy').id, { loudness: 'muted', reason: 'preview noise', by: 'user' });

    const created = store.events.upsertDerived(PR, [machine('bot_comment', 'c1', { summary: 'github-actions[bot] commented: Test report' }), other]);

    expect(created).toEqual([]);
    expect(store.events.listForPr(PR).find((event) => event.sourceId === 'c1')).toMatchObject({
      id: machine('bot_comment').id,
      kind: 'bot_comment',
      summary: 'github-actions[bot] commented: Test report',
      seenAt: at(20),
      override: { loudness: 'muted', reason: 'preview noise', by: 'user' },
    });
    expect(logged()).toEqual([
      [1, machine('bot_comment').id],
      [2, other.id],
    ]);
  });

  it('works the other way too: a bot comment that now says deploy', () => {
    store.events.upsertDerived(PR, [machine('bot_comment')]);
    store.events.markSeen([machine('bot_comment').id], at(20));
    expect(store.events.upsertDerived(PR, [machine('deploy')])).toEqual([]);
    expect(store.events.listForPr(PR)).toMatchObject([{ id: machine('deploy').id, seenAt: at(20) }]);
  });

  it('keeps the earliest sighting when both ids were logged before', () => {
    store.events.upsertDerived(PR, [machine('deploy')]);
    store.eventLog.append([{ id: machine('bot_comment').id, prKey: PR }], at(1));
    store.eventLog.append([{ id: machine('deploy').id, prKey: PR }], at(2));

    store.events.upsertDerived(PR, [machine('bot_comment')]);

    expect(logged()).toEqual([[1, machine('bot_comment').id]]);
  });

  it('leaves the log alone for an event never logged', () => {
    store.events.upsertDerived(PR, [machine('deploy')]);
    store.events.upsertDerived(PR, [machine('bot_comment')]);
    expect(logged()).toEqual([]);
    expect(store.events.listForPr(PR).map((event) => event.id)).toEqual([machine('bot_comment').id]);
  });

  it('treats any other kind change as a new event: a comment that now mentions the viewer is news', () => {
    const plain = makeEvent({ id: `${PR}:comment:c1`, prKey: PR, kind: 'comment', sourceId: 'c1' });
    const mention = makeEvent({ id: `${PR}:mention:c1`, prKey: PR, kind: 'mention', sourceId: 'c1' });
    store.events.upsertDerived(PR, [plain]);
    store.events.markSeen([plain.id], at(20));

    expect(store.events.upsertDerived(PR, [mention])).toEqual([mention.id]);
    expect(store.events.listForPr(PR)).toMatchObject([{ id: mention.id, seenAt: null }]);
  });

  it('never moves one machine comment onto another comment’s event', () => {
    store.events.upsertDerived(PR, [machine('deploy', 'c1')]);
    store.events.markSeen([machine('deploy', 'c1').id], at(20));
    expect(store.events.upsertDerived(PR, [machine('bot_comment', 'c2')])).toEqual([machine('bot_comment', 'c2').id]);
    expect(store.events.listForPr(PR)).toMatchObject([{ id: machine('bot_comment', 'c2').id, seenAt: null }]);
  });
});

describe('PrRepo.nextAfter', () => {
  it('walks the stored snapshots one at a time in key order, with their fetched_at', () => {
    for (const number of [3, 1, 2]) {
      store.prs.upsert(makePr({ number }), at(number));
    }
    const keys: Array<[string, string]> = [];
    let row = store.prs.nextAfter('');
    while (row !== null) {
      keys.push([row.pr.key, row.fetchedAt]);
      row = store.prs.nextAfter(row.key);
    }
    expect(keys).toEqual([
      ['acme/app#1', at(1)],
      ['acme/app#2', at(2)],
      ['acme/app#3', at(3)],
    ]);
  });

  it('parses for the call only: an upsert with the same fetched_at is what later reads see', () => {
    store.prs.upsert(makePr({ title: 'long' }), at(1));
    expect(store.prs.getMany([PR]).get(PR)?.title).toBe('long');
    const row = store.prs.nextAfter('')!;
    store.prs.upsert({ ...row.pr, title: 'short' }, row.fetchedAt);
    expect(store.prs.getMany([PR]).get(PR)?.title).toBe('short');
    expect(store.prs.fetchedAt(PR)).toBe(at(1));
  });
});

describe('PrRepo: snapshot_revision', () => {
  const revision = () => (store.db.prepare('SELECT snapshot_revision FROM pr WHERE key = ?').get(PR) as { snapshot_revision: number }).snapshot_revision;

  it('moves on every snapshot write, a rewrite with the same fetched_at too', () => {
    store.prs.upsert(makePr({ title: 'first' }), at(1));
    expect(revision()).toBe(1);
    store.prs.upsert(makePr({ title: 'second' }), at(1));
    expect(revision()).toBe(2);
    store.prs.upsert(makePr({ title: 'third' }), at(2));
    expect(revision()).toBe(3);
  });

  it('never hands a revision out twice, across PRs and after a delete', () => {
    store.prs.upsert(makePr({ number: 1 }), at(1));
    store.prs.upsert(makePr({ number: 2 }), at(1));
    store.prs.delete(PR);
    store.prs.upsert(makePr({ number: 1 }), at(1));
    const revisions = store.db.prepare('SELECT key, snapshot_revision FROM pr ORDER BY key').all();
    expect(revisions).toEqual([
      { key: 'acme/app#1', snapshot_revision: 3 },
      { key: 'acme/app#2', snapshot_revision: 2 },
    ]);
  });

  it('lets another connection’s cache see a PR deleted and stored again with the same fetch time', () => {
    const reader = Store.open(join(dir, 'db.sqlite'));
    try {
      store.prs.upsert(makePr({ body: 'first' }), at(1));
      expect(reader.prs.keepParsed([PR]).get(PR)?.body).toBe('first');
      store.prs.delete(PR);
      store.prs.upsert(makePr({ body: 'replacement' }), at(1));
      expect(reader.prs.keepParsed([PR]).get(PR)?.body).toBe('replacement');
    } finally {
      reader.close();
    }
  });

  it('lets another connection’s cache see a rewrite that keeps the fetch time', () => {
    const reader = Store.open(join(dir, 'db.sqlite'));
    try {
      store.prs.upsert(makePr({ body: 'a long bot report' }), at(1));
      expect(reader.prs.keepParsed([PR]).get(PR)?.body).toBe('a long bot report');
      store.prs.upsert(makePr({ body: 'cut' }), at(1));
      expect(reader.prs.keepParsed([PR]).get(PR)?.body).toBe('cut');
      expect(reader.prs.getMany([PR]).get(PR)?.body).toBe('cut');
    } finally {
      reader.close();
    }
  });
});

describe('the WAL after a big rewrite', () => {
  it('opens with a 64 MB WAL size limit, and checkpointWal empties the WAL', () => {
    expect(store.db.prepare('PRAGMA journal_size_limit').get()).toEqual({ journal_size_limit: 67108864 });
    for (let number = 1; number <= 50; number++) {
      store.prs.upsert(makePr({ number, body: 'x'.repeat(20_000) }), at(1));
    }
    const wal = join(dir, 'db.sqlite-wal');
    expect(statSync(wal).size).toBeGreaterThan(0);
    expect(store.checkpointWal()).toBe(true);
    expect(statSync(wal).size).toBe(0);
    expect(store.db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  });

  it('waits for nobody: with another connection inside a write it gives up at once and says so', () => {
    store.prs.upsert(makePr({ body: 'x'.repeat(20_000) }), at(1));
    const other = Store.open(join(dir, 'db.sqlite'));
    try {
      other.db.exec('BEGIN IMMEDIATE');
      const started = Date.now();
      expect(store.checkpointWal()).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
      other.db.exec('ROLLBACK');
    } finally {
      other.close();
    }
    expect(store.db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  });
});
