// DESIGN.md "Bot talk leaves agent work": migration 032 adds
// `pr_event.chatter`, filled for stored rows whose rule reason already
// says reply to a bot or carrier review, and the event repo round-trips it.
import { DatabaseSync } from 'node:sqlite';
import { at, makeEvent } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { runMigrations, Store } from './index.ts';

describe('migration 032', () => {
  it('marks stored replies to bots and carrier reviews as chatter, and nothing else', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 31);
    const insert = db.prepare(
      `INSERT INTO pr_event (id, pr_key, kind, actor, is_bot, at, summary, source_id, rule_loudness, rule_reason)
       VALUES (?, 'acme/app#1', ?, 'alice', 0, '2026-09-01T09:00:00.000Z', '', ?, 'quiet', ?)`,
    );
    insert.run('acme/app#1:comment:c1', 'comment', 'c1', 'replied to a bot in a review thread');
    insert.run('acme/app#1:review_commented:r1', 'review_commented', 'r1', 'only carries replies in review threads');
    insert.run('acme/app#1:comment:c2', 'comment', 'c2', 'comment on your PR');
    insert.run('acme/app#1:comment:c3', 'comment', 'c3', 'your own activity');
    runMigrations(db, 32);
    const rows = db.prepare('SELECT source_id, chatter FROM pr_event ORDER BY source_id').all();
    expect(rows.map((row) => [row.source_id, row.chatter])).toEqual([
      ['c1', 1],
      ['c2', 0],
      ['c3', 0],
      ['r1', 1],
    ]);
  });
});

describe('event chatter', () => {
  it('round-trips through upsertDerived and follows a re-derive', () => {
    const store = Store.open(':memory:');
    const event = makeEvent({ id: 'acme/app#1:comment:c1', chatter: true, at: at(1) });
    store.events.upsertDerived('acme/app#1', [event]);
    expect(store.events.listForPr('acme/app#1')[0]!.chatter).toBe(true);
    store.events.upsertDerived('acme/app#1', [{ ...event, chatter: false }]);
    expect(store.events.listForPr('acme/app#1')[0]!.chatter).toBe(false);
    store.close();
  });
});
