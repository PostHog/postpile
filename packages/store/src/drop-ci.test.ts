// What dropping CI needs from the store (DESIGN.md "CI is not tracked"):
// migration 030 removes the CI events and their log rows and nothing else,
// reads never hand out the checks an older build stored, and the strip
// helpers remove them from the json without moving a revision.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { at, makePr } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, Store } from './index.ts';

const OLD_CHECKS = { rollup: 'FAILURE', contexts: [{ name: 'test', conclusion: 'FAILURE', completedAt: '2026-09-01T09:05:00.000Z' }] };

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-drop-ci-'));
  store = Store.open(join(dir, 'db.sqlite'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The PR as a build before 0.21.0 stored it: its checks in the json. */
function storedWithChecks(number: number): string {
  const pr = makePr({ number });
  store.prs.upsert(pr, at(1));
  store.db.prepare("UPDATE pr_snapshot SET json = json_set(json, '$.checks', json(?)) WHERE key = ?").run(JSON.stringify(OLD_CHECKS), pr.key);
  return pr.key;
}

function hasChecks(key: string): boolean {
  return (store.db.prepare("SELECT json_type(json, '$.checks') AS type FROM pr_snapshot WHERE key = ?").get(key) as { type: string | null }).type !== null;
}

function revisionOf(key: string): number {
  return (store.db.prepare('SELECT snapshot_revision FROM pr WHERE key = ?').get(key) as { snapshot_revision: number }).snapshot_revision;
}

describe('migration 030', () => {
  it('deletes the CI events and every log row of a CI event, and keeps the rest with their seqs', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 29);
    const insertEvent = db.prepare(
      `INSERT INTO pr_event (id, pr_key, kind, actor, is_bot, at, summary, source_id, rule_loudness, rule_reason, seen_at)
       VALUES (?, 'acme/app#1', ?, '', 1, '2026-09-01T09:00:00.000Z', '', ?, 'quiet', '', ?)`,
    );
    insertEvent.run('acme/app#1:ci:abc:FAILURE', 'ci', 'abc:FAILURE', null);
    insertEvent.run('acme/app#1:comment:c1', 'comment', 'c1', null);
    insertEvent.run('acme/app#1:bot_comment:c2', 'bot_comment', 'c2', '2026-09-01T10:00:00.000Z');
    // Not a CI event, though "ci" follows a colon in its id.
    insertEvent.run('acme/app#1:comment:ci:x', 'comment', 'ci:x', null);
    const log = db.prepare("INSERT INTO event_log (event_id, pr_key, logged_at) VALUES (?, 'acme/app#1', '2026-09-01T09:00:00.000Z')");
    log.run('acme/app#1:comment:c1');
    // A CI event of an older head commit: its pr_event row went with the next fetch, its log row stayed.
    log.run('acme/app#1:ci:old:SUCCESS');
    log.run('acme/app#1:ci:abc:FAILURE');
    log.run('acme/app#1:bot_comment:c2');
    log.run('acme/app#1:comment:ci:x');

    runMigrations(db);

    expect(db.prepare('SELECT id, seen_at FROM pr_event ORDER BY id').all()).toEqual([
      { id: 'acme/app#1:bot_comment:c2', seen_at: '2026-09-01T10:00:00.000Z' },
      { id: 'acme/app#1:comment:c1', seen_at: null },
      { id: 'acme/app#1:comment:ci:x', seen_at: null },
    ]);
    expect(db.prepare('SELECT seq, event_id FROM event_log ORDER BY seq').all()).toEqual([
      { seq: 1, event_id: 'acme/app#1:comment:c1' },
      { seq: 4, event_id: 'acme/app#1:bot_comment:c2' },
      { seq: 5, event_id: 'acme/app#1:comment:ci:x' },
    ]);
    db.close();
  });
});

describe('PrRepo and checks stored before 0.21.0', () => {
  it('never hands them out, and a rewrite of what it read does not store them again', () => {
    const key = storedWithChecks(1);

    expect(store.prs.get(key)).not.toHaveProperty('checks');
    expect(store.prs.getMany([key]).get(key)).not.toHaveProperty('checks');
    expect(store.prs.keepParsed([key]).get(key)).not.toHaveProperty('checks');
    expect(store.prs.listAll()[0]).not.toHaveProperty('checks');
    expect(store.prs.nextAfter('')?.pr).not.toHaveProperty('checks');
    expect(store.prs.get(key)).toEqual(makePr({ number: 1 }));

    store.prs.upsert(store.prs.get(key)!, at(2));
    expect(hasChecks(key)).toBe(false);
  });

  it('strips them in SQL without a new revision, and says when there was nothing to strip', () => {
    const key = storedWithChecks(1);
    const revision = revisionOf(key);

    expect(store.prs.stripChecks(key)).toBe(true);
    expect(hasChecks(key)).toBe(false);
    expect(revisionOf(key)).toBe(revision);
    expect(store.prs.get(key)).toEqual(makePr({ number: 1 }));
    expect(store.prs.stripChecks(key)).toBe(false);
  });

  it('counts the snapshots with checks written after a revision, and walks every snapshot key', () => {
    storedWithChecks(1);
    const since = store.prs.latestRevision();
    const later = storedWithChecks(2);

    expect(store.prs.countChecksWrittenSince(since)).toBe(1);
    expect(store.prs.countChecksWrittenSince(store.prs.latestRevision())).toBe(0);
    store.prs.stripChecks(later);
    expect(store.prs.countChecksWrittenSince(since)).toBe(0);
    expect(store.prs.nextSnapshotKey('')).toBe('acme/app#1');
    expect(store.prs.nextSnapshotKey('acme/app#1')).toBe('acme/app#2');
    expect(store.prs.nextSnapshotKey('acme/app#2')).toBeNull();
  });

  it('reads in one read transaction, and leaves none open', () => {
    storedWithChecks(1);
    const reader = Store.openReadOnly(join(dir, 'db.sqlite'));
    try {
      expect(reader.prs.getMany(['acme/app#1']).size).toBe(1);
      expect(reader.prs.keepParsed(['acme/app#1']).size).toBe(1);
      expect(reader.db.isTransaction).toBe(false);
      // Inside a caller's transaction a read joins it.
      store.transaction(() => {
        expect(store.prs.getMany(['acme/app#1']).size).toBe(1);
        expect(store.db.isTransaction).toBe(true);
      });
    } finally {
      reader.close();
    }
  });
});
