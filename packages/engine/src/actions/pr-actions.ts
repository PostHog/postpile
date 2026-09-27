import type { AgentService } from '@code-manager/agent';
import type { ActionResult, Pr, PrKey } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import type { PromptContextSource } from '../prompt-context.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok } from './results.ts';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Actions on one PR that write to GitHub right away: approve and comment. */
export class PrActions {
  constructor(
    private readonly store: Store,
    private readonly writer: GitHubWriter,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly reads: ReadMarker,
    private readonly now: () => Date,
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
    try {
      await this.writer.approvePr(pr.ref, '', pr.headOid);
    } catch (error) {
      return failed(`Approve failed: ${errorText(error)}`);
    }
    this.store.userPrStates.markApproved(key, pr.headOid, this.now().toISOString());
    return ok('Approved', this.reads.markRead([key], []));
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
      await this.writer.commentOnPr(pr.ref, body);
    } catch (error) {
      return failed(`Comment failed: ${errorText(error)}`);
    }
    return ok('Comment sent');
  }
}
