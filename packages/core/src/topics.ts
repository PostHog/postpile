import type { IsoTime, Topic } from './types.ts';

/** A fresh active topic with no summary, tailoring or driver yet. */
export function newTopic(id: string, name: string, at: IsoTime): Topic {
  return {
    id,
    name,
    summary: '',
    summaryInputHash: null,
    tailoring: '',
    driver: null,
    userRole: 'watcher',
    status: 'active',
    area: null,
    createdAt: at,
    updatedAt: at,
  };
}
