import type { GlanceInput } from '@code-manager/agent';
import { Board } from '../board.ts';
import { glanceInputs } from '../glance-inputs.ts';
import { errorText, type DigestDeps } from './deps.ts';

/**
 * One glance per open PR that shows up in a tile. The input hash decides
 * whether the stored glance is still good; unread tiles go first so a small
 * budget is spent where the user looks first.
 */
export class GlanceWriter {
  constructor(private readonly deps: DigestDeps) {}

  private async glance(input: GlanceInput): Promise<void> {
    const { store, agent } = this.deps;
    if (store.glances.get(input.pr.key)?.inputHash === agent.glanceInputHash(input) || !this.deps.budget.take()) {
      return;
    }
    try {
      store.glances.put(await agent.glance(input));
    } catch (error) {
      this.deps.errors.push(`glance ${input.pr.key}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    const { store, viewer, contexts } = this.deps;
    const board = Board.load(store, this.deps.now().toISOString());
    const inputs = [...glanceInputs(board, store, viewer, contexts).values()];
    // The runner caps concurrency; budget.take is synchronous so the cap holds.
    await Promise.all(inputs.map((input) => this.glance(input)));
  }
}
