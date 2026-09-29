// Topic names are written by the agent from PR text, and several prompts
// show them outside the data fence. New names are cleaned when stored
// (`cleanTopicName`: one line, collapsed whitespace, at most 80 characters);
// this cleans the names stored before that, once.
import type { DatabaseSync } from 'node:sqlite';
import { cleanTopicName } from '@postpile/core';

export const version = 18;

export const sql = '';

export function run(db: DatabaseSync): void {
  const rows = db.prepare('SELECT id, name FROM topic').all() as { id: string; name: string }[];
  const update = db.prepare('UPDATE topic SET name = ? WHERE id = ?');
  for (const row of rows) {
    // A name with nothing left after cleaning gets a placeholder instead of going blank.
    const clean = cleanTopicName(row.name) || 'Untitled topic';
    if (clean !== row.name) {
      update.run(clean, row.id);
    }
  }
}
