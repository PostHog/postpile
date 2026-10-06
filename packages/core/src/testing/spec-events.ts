// The events a PR snapshot should give, restated from its raw fields (DESIGN
// "Rules layer: one home per fact", the loudness table in loudness.ts): one
// event per comment, sent review, commit, timeline item and finished CI run,
// its kind, and its loudness by rule as a whitelist of loud cases; one more
// per comment edited after it was posted, at its latest edit. The event
// invariant compares the board's events against this list, so `deriveEvents`
// and `ruleLoudness` are checked against the recipe, not against themselves.
import { sameLogin } from '../mentions.ts';
import type { Comment, EventKind, IsoTime, Loudness, Pr, UserPrState, Viewer } from '../types.ts';
import {
  answersBotInThread,
  asksQuestion,
  asksViewer,
  changesAnswer,
  isAutomationLogin,
  isBotCommandBody,
  isBotThreadAnswer,
  isCarrier,
  isCarrierEvent,
  isHomeTeam,
  isMachineComment,
  isOwner,
  lastSpoke,
  mentionsOnlyRoutingTeams,
  mentionsViewer,
  mentionsViewerTeam,
  saysDeploy,
  specQueueFailedAt,
  viewerOwns,
  viewerTeamsMentioned,
  viewerWasAsked,
} from './spec-facts.ts';
import { TRUNK_LOGIN } from './build-board.ts';

export interface ExpectedEvent {
  id: string;
  kind: EventKind;
  actor: string;
  at: IsoTime;
  isBot: boolean;
  /** Who a review request or its removal names; null for other events. */
  subject: string | null;
  loudness: Loudness;
  /** Why, as the event's line says it. */
  reason: string;
  /**
   * Bot talk no agent reads (2026-10-06): a person's answer to a bot in its
   * thread or command for a bot that asks the viewer nothing, a person's
   * edit of one that mentions nobody new, and GitHub's empty review that
   * only carries thread replies.
   */
  chatter: boolean;
}

/** An event before its loudness: what happened, by whom, when; `body` for a comment's event; `sourceId` for a comment's or review's. */
type RawExpected = Omit<ExpectedEvent, 'loudness' | 'reason'> & { body?: string; sourceId?: string };

/** A human speaking to the viewer directly. */
export const SPEC_ADDRESSED_KINDS: readonly EventKind[] = ['mention', 'team_mention', 'reply_to_user', 'question_to_user'];

/** The same, without team mentions: the asks a draft turns into a move or a ping. */
export const SPEC_PERSONAL_ASK_KINDS: readonly EventKind[] = ['mention', 'reply_to_user', 'question_to_user'];

export const SPEC_PUSH_KINDS: readonly EventKind[] = ['commits_pushed', 'commits_after_approval', 'force_pushed'];

export const SPEC_REVIEW_KINDS: readonly EventKind[] = ['review_approved', 'review_changes_requested', 'review_commented'];

/** Owner events that can answer a changes request (pushes by any human but the reviewer). */
const ANSWER_KINDS: readonly EventKind[] = [...SPEC_PUSH_KINDS, 'comment', 'review_commented', 'reply_to_user', 'question_to_user', 'mention'];

/** Machine kinds: quiet whoever made them. */
const MACHINE_KINDS: readonly EventKind[] = ['deploy', 'merge_queue', 'bot_comment'];

/** The viewer wrote in this thread before `comment`. */
function viewerSpokeEarlierInThread(pr: Pr, comment: Comment, viewer: Viewer): boolean {
  const thread = pr.threads.find((candidate) => candidate.id === comment.threadId);
  return thread !== undefined && thread.comments.some((earlier) => sameLogin(earlier.author, viewer.login) && earlier.createdAt < comment.createdAt);
}

/** The kind of one comment's event, or null when a review body asks nothing of the viewer (its review says it). */
function commentKind(pr: Pr, comment: Comment, viewer: Viewer): EventKind | null {
  if (isMachineComment(comment)) {
    return saysDeploy(comment.body) ? 'deploy' : 'bot_comment';
  }
  if (sameLogin(comment.author, viewer.login)) {
    return 'comment';
  }
  if (mentionsViewer(comment.body)) {
    return asksQuestion(comment.body) ? 'question_to_user' : 'mention';
  }
  if (comment.threadId !== null && viewerSpokeEarlierInThread(pr, comment, viewer)) {
    return asksQuestion(comment.body) ? 'question_to_user' : 'reply_to_user';
  }
  if (mentionsViewerTeam(comment.body, viewer)) {
    return 'team_mention';
  }
  return comment.kind === 'review' ? null : 'comment';
}

/** A person's comment that only talks to a bot, answering one in its thread or giving it a command, and asks the viewer nothing. */
function isChatterComment(pr: Pr, comment: Comment, viewer: Viewer): boolean {
  if (isMachineComment(comment)) {
    return false;
  }
  const kind = commentKind(pr, comment, viewer);
  const asks = kind !== null && SPEC_ADDRESSED_KINDS.includes(kind);
  return !asks && (answersBotInThread(pr, comment) || isBotCommandBody(comment.body));
}

const REVIEW_KINDS: Partial<Record<string, EventKind>> = {
  APPROVED: 'review_approved',
  CHANGES_REQUESTED: 'review_changes_requested',
  COMMENTED: 'review_commented',
};

/** The viewer's newest approval: the in-app one or a review on GitHub, whichever is later. */
function approvalPoint(pr: Pr, viewer: Viewer, userState: UserPrState | null): { at: IsoTime; commit: string | null } | null {
  let point = userState?.approvedAt ? { at: userState.approvedAt, commit: userState.approvedCommitOid } : null;
  for (const review of pr.reviews) {
    if (review.state === 'APPROVED' && sameLogin(review.author, viewer.login) && (point === null || review.submittedAt > point.at)) {
      point = { at: review.submittedAt, commit: review.commitOid };
    }
  }
  return point;
}

/** Commits after the approved one; by time when that commit is gone (force push). */
function commitsAfterApproval(pr: Pr, viewer: Viewer, userState: UserPrState | null): Set<string> {
  const point = approvalPoint(pr, viewer, userState);
  if (point === null) {
    return new Set();
  }
  const index = pr.commits.findIndex((commit) => commit.oid === point.commit);
  const after = index >= 0 ? pr.commits.slice(index + 1) : pr.commits.filter((commit) => commit.committedAt > point.at);
  return new Set(after.map((commit) => commit.oid));
}

/** Merged while the viewer was asked and never sent a review, on a PR someone else owns. */
function mergedWithoutViewer(pr: Pr, viewer: Viewer): boolean {
  return !viewerOwns(pr, viewer) && viewerWasAsked(pr, viewer) && lastSpoke(pr, viewer.login, true) === null;
}

/**
 * What an edited body asks of the viewer: 'you' when it @-mentions them,
 * 'team' when it names one of their home teams, else null (DESIGN "Handled
 * quietly" › Comment edits; the old body is not known).
 */
export function editedBodyAsks(body: string, viewer: Viewer): 'you' | 'team' | null {
  if (mentionsViewer(body)) {
    return 'you';
  }
  return viewerTeamsMentioned(body, viewer).some((team) => isHomeTeam(viewer, team)) ? 'team' : null;
}

/** A comment_edited event by a person (not automation, not the viewer): what its comment's body now asks of the viewer. */
export function editAsks(pr: Pr, viewer: Viewer, event: { kind: EventKind; actor: string; isBot: boolean; sourceId: string }): 'you' | 'team' | null {
  if (event.kind !== 'comment_edited' || event.isBot || event.actor === '' || sameLogin(event.actor, viewer.login)) {
    return null;
  }
  const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
  return comment ? editedBodyAsks(comment.body, viewer) : null;
}

/** Automation editing its own comment (a sticky CI report): a status update. */
export function isStatusUpdate(pr: Pr, event: { kind: EventKind; actor: string; isBot: boolean; sourceId: string }): boolean {
  if (event.kind !== 'comment_edited' || !(event.isBot || event.actor === '')) {
    return false;
  }
  const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
  return comment !== undefined && sameLogin(comment.author, event.actor);
}

/** Edited after it was posted: one event at the latest edit, by the editor (the author when unknown). */
function editExpected(pr: Pr, comment: Comment, viewer: Viewer): RawExpected | null {
  const editedAt = comment.lastEditedAt ?? null;
  if (editedAt === null || editedAt <= comment.createdAt) {
    return null;
  }
  const editor = comment.editor || comment.author;
  const isBot = sameLogin(editor, comment.author) ? isMachineComment(comment) : isAutomationLogin(editor);
  const mentionsNobodyNew = sameLogin(editor, viewer.login) || editedBodyAsks(comment.body, viewer) === null;
  const chatter = !isBot && mentionsNobodyNew && isChatterComment(pr, comment, viewer);
  return { id: `${pr.key}:comment_edited:${comment.id}@${editedAt}`, kind: 'comment_edited', actor: editor, at: editedAt, isBot, subject: null, body: comment.body, chatter };
}

const TIMELINE_KINDS: Record<string, EventKind> = {
  head_ref_force_pushed: 'force_pushed',
  added_to_merge_queue: 'merge_queue',
  removed_from_merge_queue: 'merge_queue',
  deployed: 'deploy',
};

function rawEvents(pr: Pr, viewer: Viewer, userState: UserPrState | null): RawExpected[] {
  const events: RawExpected[] = [];
  const add = (kind: EventKind, sourceId: string, actor: string, at: IsoTime, isBot: boolean, subject: string | null = null) =>
    events.push({ id: `${pr.key}:${kind}:${sourceId}`, kind, actor, at, isBot, subject, chatter: false });
  for (const comment of pr.comments) {
    const kind = commentKind(pr, comment, viewer);
    if (kind !== null) {
      const chatter = kind === 'comment' && isChatterComment(pr, comment, viewer);
      events.push({ id: `${pr.key}:${kind}:${comment.id}`, kind, actor: comment.author, at: comment.createdAt, isBot: isMachineComment(comment), subject: null, body: comment.body, sourceId: comment.id, chatter });
    }
    const edit = editExpected(pr, comment, viewer);
    if (edit !== null) {
      events.push(edit);
    }
  }
  for (const review of pr.reviews) {
    const kind = REVIEW_KINDS[review.state];
    if (kind) {
      events.push({ id: `${pr.key}:${kind}:${review.id}`, kind, actor: review.author, at: review.submittedAt, isBot: isAutomationLogin(review.author), subject: null, sourceId: review.id, chatter: isCarrier(pr, review) });
    }
  }
  const afterApproval = commitsAfterApproval(pr, viewer, userState);
  for (const commit of pr.commits) {
    add(afterApproval.has(commit.oid) ? 'commits_after_approval' : 'commits_pushed', commit.oid, commit.author, commit.committedAt, isAutomationLogin(commit.author));
  }
  for (const item of pr.timeline) {
    let kind: EventKind = TIMELINE_KINDS[item.kind] ?? (item.kind as EventKind);
    if (item.kind === 'merged' && mergedWithoutViewer(pr, viewer)) {
      kind = 'merged_without_review';
    }
    add(kind, item.id, item.actor, item.at, isAutomationLogin(item.actor), item.subject);
  }
  return events;
}

/** Part of the owner's answer to the viewer's changes request (`changesAnswer`), by kind, actor and time. */
export function answersChanges(pr: Pr, viewer: Viewer, event: { kind: EventKind; actor: string; at: IsoTime }): boolean {
  const answer = changesAnswer(pr, viewer);
  if (answer === null || !ANSWER_KINDS.includes(event.kind) || event.at <= answer.since) {
    return false;
  }
  if (SPEC_PUSH_KINDS.includes(event.kind)) {
    return !isAutomationLogin(event.actor) && !sameLogin(event.actor, viewer.login);
  }
  return isOwner(pr, event.actor);
}

const LOUD_ADDRESSED: Record<string, string> = {
  mention: 'mentions you',
  team_mention: 'mentions your team',
  reply_to_user: 'replies to you',
  question_to_user: 'asks you a question',
};

function spokeAfter(pr: Pr, login: string, at: IsoTime, reviewsOnly = false): boolean {
  const spoke = lastSpoke(pr, login, reviewsOnly);
  return spoke !== null && spoke > at;
}

/**
 * Loudness by rule, with the reason the event's line gives. Loud: an
 * addressed kind the viewer has not spoken after, the owner's answer to
 * the viewer's changes request, a review on the viewer's PR (one they own), a review
 * request for the viewer or their team that is still open on a non-draft
 * PR, ready for review when the viewer was asked, a comment on the
 * viewer's PR, a person's comment edit whose body now mentions the viewer or
 * a home team (not spoken after), trunk's comment or edit that took the
 * viewer's own PR out of the merge queue while it is still out. Never loud:
 * the viewer's own activity and other automation (a bot push to a draft is muted). A request for the viewer counts as a person's
 * whoever clicked it. Everything else is quiet.
 */
function loudnessOf(pr: Pr, viewer: Viewer, event: RawExpected): { loudness: Loudness; reason: string } {
  const quiet = (reason: string) => ({ loudness: 'quiet' as const, reason });
  const loud = (reason: string) => ({ loudness: 'loud' as const, reason });
  if (event.actor !== '' && sameLogin(event.actor, viewer.login)) {
    return quiet('your own activity');
  }
  // Trunk's comment or edit that took the viewer's own PR out of the merge queue, while it is still out (DESIGN "Merge queue").
  const trunkStatus = (event.kind === 'bot_comment' || event.kind === 'comment_edited') && sameLogin(event.actor, TRUNK_LOGIN);
  const failure = trunkStatus && viewerOwns(pr, viewer) ? specQueueFailedAt(pr, event.at) : null;
  if (failure !== null) {
    return loud(failure.reason === null ? 'removed from the merge queue' : `removed from the merge queue: ${failure.reason}`);
  }
  const requestForViewer = event.kind === 'review_requested' && asksViewer(viewer, event.subject);
  const automation = (event.isBot || event.actor === '') && !requestForViewer;
  if (automation || MACHINE_KINDS.includes(event.kind)) {
    return event.isBot && SPEC_PUSH_KINDS.includes(event.kind) && pr.isDraft ? { loudness: 'muted', reason: 'bot pushed to a draft' } : quiet('bot activity');
  }
  const own = viewerOwns(pr, viewer);
  if (event.kind === 'comment_edited') {
    // A person's edit: quiet, unless the body now mentions the viewer or a home team and they have not spoken since.
    const asks = editedBodyAsks(event.body ?? '', viewer);
    if (asks === null) {
      return quiet('edited a comment');
    }
    if (spokeAfter(pr, viewer.login, event.at)) {
      return quiet('you already replied');
    }
    return loud(asks === 'you' ? 'edited to mention you' : 'edited to mention your team');
  }
  if (SPEC_ADDRESSED_KINDS.includes(event.kind)) {
    if (spokeAfter(pr, viewer.login, event.at)) {
      return quiet('you already replied');
    }
    // A mention of teams that only route reviews to the viewer keeps them posted (DESIGN "Team roles"); a home team named too makes it loud.
    if (event.kind === 'team_mention' && mentionsOnlyRoutingTeams(event.body ?? '', viewer)) {
      return quiet('mentions a team that only routes reviews to you');
    }
    return loud(LOUD_ADDRESSED[event.kind]!);
  }
  // The empty review GitHub wraps thread replies in is no review: its replies speak for themselves (2026-10-06).
  if (event.kind === 'review_commented' && event.sourceId !== undefined && isCarrierEvent(pr, { kind: event.kind, sourceId: event.sourceId })) {
    return quiet('only carries replies in review threads');
  }
  // Answering a review bot in its thread is housekeeping, even on the viewer's PR or as an answer to their changes request (2026-10-06).
  if (event.kind === 'comment' && event.sourceId !== undefined && isBotThreadAnswer(pr, { kind: event.kind, sourceId: event.sourceId })) {
    return quiet('replied to a bot in a review thread');
  }
  // Telling a bot what to do ("@codex review") is housekeeping too, on any PR (2026-10-06); one that mentions or answers the viewer is an ask above.
  if (event.kind === 'comment' && isBotCommandBody(event.body ?? '')) {
    return quiet('a command for a bot');
  }
  if (answersChanges(pr, viewer, event)) {
    return loud('addressed your changes');
  }
  if (SPEC_REVIEW_KINDS.includes(event.kind)) {
    return own ? loud('review on your PR') : quiet('review by someone else');
  }
  if (requestForViewer) {
    if (pr.isDraft && pr.state === 'OPEN') {
      return quiet('review requested on a draft');
    }
    const removedAfter = pr.timeline.some((item) => item.kind === 'review_request_removed' && item.subject === event.subject && item.at > event.at);
    return spokeAfter(pr, viewer.login, event.at, true) || removedAfter ? quiet('review request already answered or removed') : loud('review requested from you');
  }
  switch (event.kind) {
    case 'review_requested':
      return quiet('review requested from someone else');
    case 'commits_after_approval':
      return quiet('new commits after you approved');
    case 'ready_for_review':
      return !own && viewerWasAsked(pr, viewer) ? loud('ready for your review') : quiet('ready for review');
    case 'merged_without_review':
      return quiet('merged without your review');
    case 'comment':
      return own ? loud('comment on your PR') : quiet('comment');
    default:
      return quiet(event.kind.replaceAll('_', ' '));
  }
}

/** Every event the snapshot should give, with its loudness by rule. The app's Look closer event is not derived and not listed. */
export function expectedEvents(pr: Pr, viewer: Viewer, userState: UserPrState | null): ExpectedEvent[] {
  return rawEvents(pr, viewer, userState).map((raw) => ({
    id: raw.id,
    kind: raw.kind,
    actor: raw.actor,
    at: raw.at,
    isBot: raw.isBot,
    subject: raw.subject,
    chatter: raw.chatter,
    ...loudnessOf(pr, viewer, raw),
  }));
}
