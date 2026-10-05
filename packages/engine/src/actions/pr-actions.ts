import type { AgentService, PromptContext } from '@postpile/agent';
import {
  findComment,
  findReactable,
  isOwnTeam,
  prReadScope,
  quotedReplyBody,
  replyConversation,
  replyTarget,
  teamSlug,
  viewerHeadReview,
  type ActionResult,
  type Pr,
  type PrKey,
  type ReplyTarget,
  type ReviewNoteKind,
  type Viewer,
  withViewerReaction,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { PromptContextSource } from '../prompt-context.ts';
import { errorText } from '../errors.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { ReadMarker } from './read-marker.ts';
import { failed, ok } from './results.ts';
import { reviewNoteGlanceNotes, reviewNoteIntent } from './review-note.ts';

/** Why an approval is refused when the stored head moved past the one on screen. */
export const NEW_COMMITS_SINCE_LOOKED = 'New commits since you looked; take another look';

/** Actions on one PR that write to GitHub right away: approve, comment review and comment. */
export class PrActions {
  constructor(
    private readonly store: Store,
    private readonly writes: GitHubWrites,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly readMarker: ReadMarker,
    private readonly now: () => Date,
    /** Fetches the PR again right after a write. Comment, comment review and "Remove <team>" wait for it; approve does not. */
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
   * GitHub call, so nobody approves commits they have not seen. `body` is
   * the optional note from "Approve with comment"; empty sends none.
   */
  async approve(key: PrKey, headOid: string, body = ''): Promise<ActionResult> {
    const pr = this.openPr(key);
    if (!pr) {
      return failed(`${key} is not an open PR in the store`);
    }
    if (pr.headOid !== headOid) {
      return failed(NEW_COMMITS_SINCE_LOOKED);
    }
    const origin = { origin: 'tile' as const, prKey: key };
    try {
      if ((await this.writes.approvePr(pr.ref, body, pr.headOid, origin)) === 'off') {
        return failed('GitHub writes are off (lock in the footer): nothing was approved');
      }
    } catch (error) {
      return failed(`Approve failed: ${errorText(error)}`);
    }
    this.store.userPrStates.markApproved(key, pr.headOid, this.now().toISOString());
    // Mark read first: what the refresh brings in is news the user has not seen.
    const batch = this.readMarker.markRead(prReadScope(key, true), { kind: 'approved' }, { origin: 'tile', tileId: null });
    // Not awaited: the approval and the mark-read are stored, so the answer
    // does not wait for a poll cycle (seconds). The refresh never throws.
    void this.refreshPr(key);
    // No undo: the token only covers the follow-up mark-read, and "Approved ·
    // Undo" reads as taking back the approval. The settle token still lets the
    // renderer refetch once the mark-read's window settled.
    return { ...ok('Approved'), settleToken: batch.token };
  }

  /**
   * "Comment review" in the detail pane (2026-10-02): a review with event
   * COMMENT, pinned to `headOid` with the same head check as approve. It
   * answers a review request without being the approval that clears the PR
   * for merging. Final like approve, blocked while writes are locked. After
   * it, the PR's events turn seen like after an approval, and the refreshed
   * PR carries the review, so the turn rules see the viewer reviewed the head.
   */
  async commentReview(key: PrKey, headOid: string, body: string): Promise<ActionResult> {
    const pr = this.openPr(key);
    if (!pr) {
      return failed(`${key} is not an open PR in the store`);
    }
    if (body.trim() === '') {
      return failed('A comment review needs a note');
    }
    if (pr.headOid !== headOid) {
      return failed(NEW_COMMITS_SINCE_LOOKED);
    }
    const previousReviewAt = this.viewerReviewAt(key);
    try {
      if ((await this.writes.commentReviewPr(pr.ref, body, pr.headOid, { origin: 'tile', prKey: key })) === 'off') {
        return failed('GitHub writes are off (lock in the footer): nothing was posted');
      }
    } catch (error) {
      return failed(`Comment review failed: ${errorText(error)}`);
    }
    // Mark read first: what the refresh brings in is news the user has not seen.
    const batch = this.readMarker.markRead(prReadScope(key, true), { kind: 'approved' }, { origin: 'tile', tileId: null });
    await this.refreshPr(key);
    this.mirrorReview(key, pr.headOid, body, previousReviewAt);
    return { ...ok('Comment review posted'), settleToken: batch.token };
  }

  /** When the viewer's newest review of the stored head was submitted, or null without one. */
  private viewerReviewAt(key: PrKey): string | null {
    const stored = this.store.prs.get(key);
    const viewer = loadViewer(this.store);
    return stored && viewer ? (viewerHeadReview(stored, viewer)?.submittedAt ?? null) : null;
  }

  /**
   * GitHub took the comment review; when the stored snapshot does not show a
   * review by the viewer newer than the one before the write (the refresh
   * failed or GitHub lagged), it adds one and drops the viewer's pending
   * personal request, like GitHub does on answering. An earlier review on the
   * same head (say CHANGES_REQUESTED) must not count as this one. The next
   * sync brings GitHub's copy.
   */
  private mirrorReview(key: PrKey, headOid: string, body: string, previousReviewAt: string | null): void {
    const stored = this.store.prs.get(key);
    const fetchedAt = this.store.prs.fetchedAtByKey().get(key);
    const viewer = loadViewer(this.store);
    if (!stored || !fetchedAt || !viewer || stored.headOid !== headOid) {
      return;
    }
    const latest = viewerHeadReview(stored, viewer);
    if (latest !== null && (previousReviewAt === null || latest.submittedAt > previousReviewAt)) {
      return;
    }
    const at = this.now().toISOString();
    const review = { id: `local-review-${at}`, author: viewer.login, state: 'COMMENTED' as const, body, submittedAt: at, commitOid: headOid };
    const reviewerUsers = stored.reviewerUsers.filter((login) => login.toLowerCase() !== viewer.login.toLowerCase());
    this.store.prs.upsert({ ...stored, reviews: [...stored.reviews, review], reviewerUsers }, fetchedAt);
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

  /** The stored PR and the viewer a draft needs; throws before the first sync. */
  private draftInputs(key: PrKey): { pr: Pr; viewer: Viewer } {
    const pr = this.store.prs.get(key);
    const viewer = loadViewer(this.store);
    if (!pr || !viewer) {
      throw new Error(`${key} is not in the store yet; run a sync first`);
    }
    return { pr, viewer };
  }

  /** The instructions and work context of the PR's topic, for drafts. */
  private contextFor(key: PrKey): PromptContext {
    const topicId = this.store.memberships.get(key)?.topicId ?? null;
    return this.contexts.forTopic(topicId);
  }

  /** "Ask <person>": a draft through the agent the user edits before sendComment. Never sent by the agent. */
  async draftAsk(key: PrKey, person: string, intent: string): Promise<{ body: string }> {
    const { pr, viewer } = this.draftInputs(key);
    return this.agent.draftComment({ pr, viewer, person, intent, notes: [], context: this.contextFor(key) });
  }

  /**
   * The draft for the review note popover (Approve with comment, Comment
   * review): addressed to nobody, fed the glance. A non-empty `gist` is the
   * user's own text ("Rewrite with the agent") the note is written from.
   */
  async draftReviewNote(key: PrKey, kind: ReviewNoteKind, gist = ''): Promise<{ body: string }> {
    const { pr, viewer } = this.draftInputs(key);
    const notes = reviewNoteGlanceNotes(this.store.glances.get(key));
    return this.agent.draftComment({ pr, viewer, person: null, intent: reviewNoteIntent(kind), notes, gist, context: this.contextFor(key) });
  }

  /**
   * A reply to one comment, drafted from its thread or the conversation
   * around it, or from the user's own words in `gist`. Never sent by the agent.
   */
  async draftReply(key: PrKey, commentId: string, gist: string): Promise<{ body: string }> {
    const { pr, viewer } = this.draftInputs(key);
    const comment = findComment(pr, commentId);
    if (!comment) {
      throw new Error(`no comment ${commentId} on ${key}`);
    }
    return this.agent.draftReply({
      pr,
      viewer,
      comment,
      conversation: replyConversation(pr, comment),
      gist,
      notes: reviewNoteGlanceNotes(this.store.glances.get(key)),
      context: this.contextFor(key),
    });
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

  /**
   * A reply to one comment (2026-10-05): an inline comment is answered in its
   * review thread; an issue comment or review body gets a new PR comment
   * that quotes its first line and mentions its author (`quotedReplyBody`).
   * Final, blocked while writes are locked; the PR is fetched again after.
   */
  async replyToComment(key: PrKey, commentId: string, body: string): Promise<{ result: ActionResult; target: ReplyTarget | null }> {
    const pr = this.store.prs.get(key);
    const comment = pr ? findComment(pr, commentId) : null;
    if (!pr || !comment) {
      return { result: failed(`No comment ${commentId} on ${key} in the store`), target: null };
    }
    if (body.trim() === '') {
      return { result: failed('Empty reply'), target: null };
    }
    const target = replyTarget(comment);
    const context = { origin: 'detail' as const, prKey: key };
    try {
      const sent =
        target.kind === 'thread'
          ? await this.writes.replyInThread(target.threadId, body, context)
          : await this.writes.replyOnPr(pr.ref, quotedReplyBody(comment, body), { ...context, detail: `reply to ${comment.author}'s comment ${comment.id}` });
      if (sent === 'off') {
        return { result: failed('GitHub writes are off (lock in the footer): the reply was not sent'), target };
      }
    } catch (error) {
      return { result: failed(`Reply failed: ${errorText(error)}`), target };
    }
    await this.refreshPr(key);
    return { result: ok('Reply sent'), target };
  }

  /**
   * A thumbs up on a comment or a review (an approval without a body is no
   * comment, but GitHub takes a reaction on the review). Final like a
   * comment. Nothing else on the PR changes, so there is no refetch: the
   * stored snapshot is marked right away, and the next poll reads GitHub's.
   */
  async react(key: PrKey, id: string): Promise<ActionResult> {
    const pr = this.store.prs.get(key);
    if (!pr || !findReactable(pr, id)) {
      return failed(`No comment or review ${id} on ${key} in the store`);
    }
    try {
      if ((await this.writes.addThumbsUp(id, { origin: 'detail', prKey: key })) === 'off') {
        return failed('GitHub writes are off (lock in the footer): the reaction was not sent');
      }
    } catch (error) {
      return failed(`Reaction failed: ${errorText(error)}`);
    }
    // The fetch time stays: the snapshot is no newer than it was.
    const fetchedAt = this.store.prs.fetchedAtByKey().get(key);
    if (fetchedAt) {
      this.store.prs.upsert(withViewerReaction(pr, id), fetchedAt);
    }
    return ok('Thumbs up sent');
  }
}
