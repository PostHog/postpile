import type { DatabaseSync } from 'node:sqlite';

export interface AgentCacheEntry {
  key: string;
  purpose: string;
  model: string;
  output: string;
  createdAt: string;
}

export class AgentCacheRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(_key: string): AgentCacheEntry | null {
    throw new Error('not implemented');
  }

  put(_entry: AgentCacheEntry): void {
    throw new Error('not implemented');
  }
}
