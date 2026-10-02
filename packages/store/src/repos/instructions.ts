import type { DatabaseSync } from 'node:sqlite';
import type { InstructionsOrigin, InstructionsVersion } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, one, run } from '../sql.ts';

interface InstructionsRow {
  version: number;
  text: string;
  summary: string;
  origin: string;
  source_chat_message_id: number | null;
  source_lesson_id: number | null;
  created_at: string;
}

function toVersion(row: InstructionsRow): InstructionsVersion {
  return {
    version: row.version,
    text: row.text,
    summary: row.summary,
    origin: row.origin as InstructionsOrigin,
    sourceChatMessageId: row.source_chat_message_id,
    sourceLessonId: row.source_lesson_id,
    createdAt: row.created_at,
  };
}

export type NewInstructionsVersion = Omit<InstructionsVersion, 'version'>;

/** Every known version of instructions.md, numbered 1, 2, 3, ... Never pruned: the text is small and the user's own. */
export class InstructionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  latest(): InstructionsVersion | null {
    const row = one<InstructionsRow>(this.db, 'SELECT * FROM instructions_version ORDER BY version DESC LIMIT 1');
    return row ? toVersion(row) : null;
  }

  get(version: number): InstructionsVersion | null {
    const row = one<InstructionsRow>(this.db, 'SELECT * FROM instructions_version WHERE version = ?', version);
    return row ? toVersion(row) : null;
  }

  /** Newest first. */
  list(limit: number): InstructionsVersion[] {
    return all<InstructionsRow>(this.db, 'SELECT * FROM instructions_version ORDER BY version DESC LIMIT ?', limit).map(toVersion);
  }

  /** Stores the next version and returns it. */
  add(version: NewInstructionsVersion): InstructionsVersion {
    return inTransaction(this.db, () => {
      const next = (this.latest()?.version ?? 0) + 1;
      run(
        this.db,
        `INSERT INTO instructions_version (version, text, summary, origin, source_chat_message_id, source_lesson_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        next,
        version.text,
        version.summary,
        version.origin,
        version.sourceChatMessageId,
        version.sourceLessonId,
        version.createdAt,
      );
      return { version: next, ...version };
    });
  }
}
