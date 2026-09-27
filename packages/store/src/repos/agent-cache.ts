import type { DatabaseSync } from 'node:sqlite';
import { one, run } from '../sql.ts';

export interface AgentCacheEntry {
  key: string;
  purpose: string;
  model: string;
  output: string;
  createdAt: string;
}

interface AgentCacheRow {
  key: string;
  purpose: string;
  model: string;
  output: string;
  created_at: string;
}

export class AgentCacheRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): AgentCacheEntry | null {
    const row = one<AgentCacheRow>(this.db, 'SELECT * FROM agent_cache WHERE key = ?', key);
    if (!row) {
      return null;
    }
    return { key: row.key, purpose: row.purpose, model: row.model, output: row.output, createdAt: row.created_at };
  }

  put(entry: AgentCacheEntry): void {
    run(
      this.db,
      `INSERT INTO agent_cache (key, purpose, model, output, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         purpose = excluded.purpose, model = excluded.model, output = excluded.output, created_at = excluded.created_at`,
      entry.key,
      entry.purpose,
      entry.model,
      entry.output,
      entry.createdAt,
    );
  }
}
