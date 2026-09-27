import type { DatabaseSync } from 'node:sqlite';
import type { Topic } from '@code-manager/core';

export class TopicRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(_topic: Topic): void {
    throw new Error('not implemented');
  }

  get(_id: string): Topic | null {
    throw new Error('not implemented');
  }

  list(): Topic[] {
    throw new Error('not implemented');
  }

  updateSummary(_id: string, _summary: string, _inputHash: string, _at: string): void {
    throw new Error('not implemented');
  }

  /** Only called after the user confirmed "keep it". */
  setTailoring(_id: string, _tailoring: string, _at: string): void {
    throw new Error('not implemented');
  }

  /** Only called when the user accepted a rename proposal. */
  rename(_id: string, _name: string, _at: string): void {
    throw new Error('not implemented');
  }
}
