import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { currentVersion, openDatabase, runMigrations } from './index.ts';
import * as init from './migrations/001_init.ts';

describe('migrations', () => {
  it('creates the schema on a fresh database and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(currentVersion(db)).toBe(4);
    runMigrations(db);
    expect(currentVersion(db)).toBe(4);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const names = tables.map((row) => row.name);
    for (const table of ['pr_glance', 'event_log', 'cursor', 'topic_dossier', 'fact', 'fact_ref', 'rule_proposal', 'agent_call', 'instructions_version']) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('gives events that existed before v2 an event_log seq in time order', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(init.sql);
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec("INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-09-01T00:00:00.000Z')");
    const insert = db.prepare(
      `INSERT INTO pr_event (id, pr_key, kind, actor, is_bot, at, summary, source_id, rule_loudness, rule_reason)
       VALUES (?, 'acme/app#1', 'comment', 'alice', 0, ?, '', ?, 'quiet', '')`,
    );
    insert.run('acme/app#1:comment:b', '2026-09-02T00:00:00.000Z', 'b');
    insert.run('acme/app#1:comment:a', '2026-09-01T00:00:00.000Z', 'a');

    runMigrations(db);

    const rows = db.prepare('SELECT seq, event_id FROM event_log ORDER BY seq').all();
    expect(rows.map((row) => row.event_id)).toEqual(['acme/app#1:comment:a', 'acme/app#1:comment:b']);
    db.close();
  });
});
