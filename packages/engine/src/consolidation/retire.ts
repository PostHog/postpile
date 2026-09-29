import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { RetireGate } from './retire-gate.ts';

/**
 * The sync's retire step, no agent verdict needed: every active topic that
 * passes the gate is retired. Runs after the digest, so events it just
 * stored count. Unsorted is no stored topic, so it never retires. Returns
 * how many topics retired.
 */
export function retireFinishedTopics(store: Store, at: string): number {
  const gate = new RetireGate(Board.load(store, at));
  const finished = store.topics.listActive().filter((topic) => gate.passes(topic.id));
  store.transaction(() => {
    for (const topic of finished) {
      store.topics.setStatus(topic.id, 'retired', at);
    }
  });
  return finished.length;
}
