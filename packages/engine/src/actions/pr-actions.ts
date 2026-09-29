import type { AgentService } from '@postpile/agent';
import { isOwnTeam, prReadScope, teamSlug, type ActionResult, type Pr, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { PromptContextSource } from '../prompt-context.ts';
import { errorText } from '../errors.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok } from './results.ts';

/** Why an approval is refused when the stored head moved past the one on screen. */
export const NEW_COMMITS_SINCE_LOOKED = 'New commits since you looked; take another look';

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
   * state, never the approval. The review is pinned to `headOid`, the commit
   * the renderer showed. A poll can move the stored head a few seconds
   * before the renderer refreshes; then the approval is refused without a
   * GitHub call, so nobody approves commits they have not seen.
   */
  async approve(key: PrKey, headOid: string): Promise<ActionResult> {
    const pr = this.openPr(key);
    if (!pr) {
      return failed(`${key} is not an open PR in the store`);
    }
    if (pr.headOid !== headOid) {
      return failed(NEW_COMMITS_SINCE_LOOKED);
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
    const batch = this.readMarker.markRead(prReadScope(key, true), { kind: 'approved' }, { origin: 'tile', tileId: null });
    await this.refreshPr(key);
    return ok('Approved', batch.token);
  }

  /** Unsubscribes from the PR's thread; says what happened, never throws. */
  private async unsubscribe(key: PrKey): Promise<string> {
    const thread = this.store.notifications.getByPrKeys([key]).get(key);
    if (!thread) {
      return 'no notification thread known, so not unsubscribed';
    }
    try {
      if ((await this.writes.unsubscribeThread(thread.id, { origin: 'detail', prKey: key })) === 'off') {
        return 'GitHub writes turned off, so not unsubscribed';
      }
    } catch (error) {
      return `unsubscribe failed: ${errorText(error)}`;
    }
    return 'unsubscribed';
  }

  /**
   * "Remove <team>" in the detail pane (2026-09-29): removes the review
   * request of one of the viewer's teams, unsubscribes from the PR's thread
   * and marks the PR done here (events seen, handled, thread marked read
   * through the queue). Final: no undo, re-adding the team would notify every
   * teammate again. Blocked while writes are locked, never a pending write.
   * A failed removal stops; a failed unsubscribe still marks the PR done.
   */
  async removeTeamRequest(key: PrKey, team: string): Promise<ActionResult> {
    const pr = this.openPr(key);
    const viewer = loadViewer(this.store);
    if (!pr || !viewer) {
      return failed(`${key} is not an open PR in the store`);
    }
    if (!pr.reviewerTeams.includes(team) || !isOwnTeam(team, viewer.teams)) {
      return failed(`${team} has no pending review request of your team on ${key}`);
    }
    const slug = teamSlug(team);
    try {
      if ((await this.writes.removeTeamReviewRequest(pr.ref, slug, { origin: 'detail', prKey: key })) === 'off') {
        return failed('GitHub writes are off (lock in the footer): nothing was removed');
      }
    } catch (error) {
      return failed(`Removing ${slug} failed: ${errorText(error)}`);
    }
    const unsubscribed = await this.unsubscribe(key);
    const batch = this.readMarker.markRead(prReadScope(key, true), { kind: 'button' }, { origin: 'detail', tileId: null });
    await this.refreshPr(key);
    this.mirrorRemoval(key, team);
    // No undo (the removal is final), but the renderer watches the mark-read until it settles.
    return { ...ok(`Removed ${slug}'s review request, ${unsubscribed}`), settleToken: batch.token };
  }

  /**
   * GitHub took the removal; when the stored snapshot still lists the team
   * (the refresh failed or GitHub lagged), it drops it too, so the handled PR
   * is done until the next sync brings the PR back. The fetch time stays, so
   * the snapshot is not taken for fresher than it is.
   */
  private mirrorRemoval(key: PrKey, team: string): void {
    const stored = this.store.prs.get(key);
    const fetchedAt = this.store.prs.fetchedAtByKey().get(key);
    if (stored && fetchedAt && stored.reviewerTeams.includes(team)) {
      this.store.prs.upsert({ ...stored, reviewerTeams: stored.reviewerTeams.filter((candidate) => candidate !== team) }, fetchedAt);
    }
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
