import type { AgentService } from '@postpile/agent';
import type { ActionResult, Pr, PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { PromptContextSource } from '../prompt-context.ts';
import { errorText } from '../errors.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok } from './results.ts';

/** Actions on one PR that write to GitHub right away: approve and comment. */
export class PrActions {
  constructor(
    private readonly store: Store,
    private readonly writes: GitHubWrites,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
    /** Fetches the PR again right after a write, so the answer already shows GitHub's new state. */
    private readonly refreshPr: (key: PrKey) => Promise<void> = async () => {},
  ) {}

  private openPr(key: PrKey): Pr | null {
    const pr = this.store.prs.get(key);
    return pr && pr.state === 'OPEN' ? pr : null;
  }

  /**
   * Immediate and final. Approving answers the ping, so the PR's events are
   * marked read too; the returned undo token only brings back the unread
   * state, never the approval. The review is pinned to the stored head, the
   * commit the glance and the user looked at; a later push shows up as
   * "new commits after approval" on the next sync.
   */
  async approve(key: PrKey): Promise<ActionResult> {
    const pr = this.openPr(key);
    if (!pr) {
      return failed(`${key} is not an open PR in the store`);
    }
    const origin = { origin: 'tile' as const, prKey: key };
    try {
      if ((await this.writes.approvePr(pr.ref, '', pr.headOid, origin)) === 'off') {
        return failed('GitHub writes are off (lock in the footer): nothing was approved');
      }
    } catch (error) {
      return failed(`Approve failed: ${errorText(error)}`);
    }
    this.store.userPrStates.markApproved(key, pr.headOid, this.now().toISOString());
    // Mark read first: what the refresh brings in is news the user has not seen.
    const batch = this.readMarker.markRead([key], [], { origin: 'tile', tileId: null });
    await this.refreshPr(key);
    return ok('Approved', batch.token);
  }

  async draftAsk(key: PrKey, person: string, intent: string): Promise<{ body: string }> {
    const pr = this.store.prs.get(key);
    const viewer = loadViewer(this.store);
    if (!pr || !viewer) {
      throw new Error(`${key} is not in the store yet; run a sync first`);
    }
    const topicId = this.store.memberships.get(key)?.topicId ?? null;
    return this.agent.draftComment({ pr, viewer, person, intent, context: this.contexts.forTopic(topicId) });
  }

  async sendComment(key: PrKey, body: string): Promise<ActionResult> {
    const pr = this.store.prs.get(key);
    if (!pr) {
      return failed(`${key} is not in the store`);
    }
    if (body.trim() === '') {
      return failed('Empty comment');
    }
    try {
      if ((await this.writes.commentOnPr(pr.ref, body, { origin: 'tile', prKey: key })) === 'off') {
        return failed('GitHub writes are off (lock in the footer): the comment was not sent');
      }
    } catch (error) {
      return failed(`Comment failed: ${errorText(error)}`);
    }
    await this.refreshPr(key);
    return ok('Comment sent');
  }
}
