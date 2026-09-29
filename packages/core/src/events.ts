import { isBot, isMachineComment } from './bots.ts';
import { ADDRESSED_KINDS } from './kinds.ts';
import { ruleLoudness } from './loudness.ts';
import { isViewerSubject, mentionsAnyTeam, mentionsUser, sameLogin } from './mentions.ts';
import type { Comment, EventKind, IsoTime, Pr, PrEvent, TimelineItem, UserPrState, Viewer } from './types.ts';

/** What deriveEvents knows about an event before it gets classified. */
interface RawEvent {
  kind: EventKind;
  actor: string;
  isBot: boolean;
  at: IsoTime;
  summary: string;
  url: string | null;
  sourceId: string;
  subject: string | null;
}

interface ApprovalPoint {
  at: IsoTime;
  commitOid: string | null;
}

const deployBody = /\b(deploy(ed|ment)?|preview)\b/i;

function oneLine(text: string, max = 100): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function withText(prefix: string, body: string): string {
  const text = oneLine(body);
  return text === '' ? prefix : `${prefix}: ${text}`;
}

/**
 * A pending review is the viewer's unsent draft: GitHub shows it only to
 * them, so it never answers anything.
 */
function viewerSpokeAfter(pr: Pr, viewer: Viewer, at: IsoTime): boolean {
  const spokeInComment = pr.comments.some((c) => sameLogin(c.author, viewer.login) && c.createdAt > at);
  const spokeInReview = pr.reviews.some(
    (r) => sameLogin(r.author, viewer.login) && r.state !== 'PENDING' && r.submittedAt > at,
  );
  return spokeInComment || spokeInReview;
}

/**
 * A review request is answered once the viewer submitted a review after it,
 * or once the same request was removed later. Otherwise the first fetch of an
 * old PR would show a long-handled request as unread.
 */
function requestAnswered(pr: Pr, viewer: Viewer, raw: RawEvent): boolean {
  if (raw.kind !== 'review_requested') {
    return false;
  }
  const reviewedAfter = pr.reviews.some(
    (r) => sameLogin(r.author, viewer.login) && r.state !== 'PENDING' && r.submittedAt > raw.at,
  );
  const removedAfter = pr.timeline.some(
    (item) => item.kind === 'review_request_removed' && item.subject === raw.subject && item.at > raw.at,
  );
  return reviewedAfter || removedAfter;
}

// A reply inside a review thread never @-mentions the viewer, so nothing else
// would find it. Same signal ghatchup uses.
function isReplyToViewer(comment: Comment, pr: Pr, viewer: Viewer): boolean {
  if (!comment.threadId) {
    return false;
  }
  const thread = pr.threads.find((t) => t.id === comment.threadId);
  if (!thread) {
    return false;
  }
  return thread.comments.some((c) => sameLogin(c.author, viewer.login) && c.createdAt < comment.createdAt);
}

function addressedKind(comment: Comment, pr: Pr, viewer: Viewer): EventKind | null {
  const isQuestion = comment.body.includes('?');
  if (mentionsUser(comment.body, viewer.login)) {
    return isQuestion ? 'question_to_user' : 'mention';
  }
  if (isReplyToViewer(comment, pr, viewer)) {
    return isQuestion ? 'question_to_user' : 'reply_to_user';
  }
  if (mentionsAnyTeam(comment.body, viewer.teams)) {
    return 'team_mention';
  }
  return null;
}

function commentSummary(kind: EventKind, comment: Comment): string {
  switch (kind) {
    case 'mention':
      return withText(`${comment.author} mentioned you`, comment.body);
    case 'question_to_user':
      return withText(`${comment.author} asked you`, comment.body);
    case 'reply_to_user':
      return withText(`${comment.author} replied to you`, comment.body);
    case 'team_mention':
      return withText(`${comment.author} mentioned your team`, comment.body);
    case 'deploy':
      return withText(`${comment.author} deploy`, comment.body);
    default:
      return withText(`${comment.author} commented`, comment.body);
  }
}

function commentEvent(comment: Comment, pr: Pr, viewer: Viewer): RawEvent | null {
  const machine = isMachineComment(comment);
  let kind: EventKind | null;
  if (machine) {
    kind = deployBody.test(comment.body) ? 'deploy' : 'bot_comment';
  } else if (sameLogin(comment.author, viewer.login)) {
    kind = 'comment';
  } else {
    kind = addressedKind(comment, pr, viewer);
  }
  // A review body without anything addressed to the viewer is already
  // covered by the review event itself.
  if (kind === null && comment.kind === 'review') {
    return null;
  }
  const finalKind = kind ?? 'comment';
  return {
    kind: finalKind,
    actor: comment.author,
    isBot: machine,
    at: comment.createdAt,
    summary: commentSummary(finalKind, comment),
    url: comment.url,
    sourceId: comment.id,
    subject: null,
  };
}

function reviewEvents(pr: Pr): RawEvent[] {
  const events: RawEvent[] = [];
  for (const review of pr.reviews) {
    let kind: EventKind;
    let verb: string;
    if (review.state === 'APPROVED') {
      kind = 'review_approved';
      verb = 'approved';
    } else if (review.state === 'CHANGES_REQUESTED') {
      kind = 'review_changes_requested';
      verb = 'requested changes';
    } else if (review.state === 'COMMENTED') {
      kind = 'review_commented';
      verb = 'reviewed';
    } else {
      continue;
    }
    events.push({
      kind,
      actor: review.author,
      isBot: isBot(review.author),
      at: review.submittedAt,
      summary: withText(`${review.author} ${verb}`, review.body),
      url: null,
      sourceId: review.id,
      subject: null,
    });
  }
  return events;
}

/** The latest point the viewer approved, from the app or from GitHub itself. */
function approvalPoint(pr: Pr, viewer: Viewer, userState: UserPrState | null): ApprovalPoint | null {
  let point: ApprovalPoint | null = null;
  if (userState?.approvedAt) {
    point = { at: userState.approvedAt, commitOid: userState.approvedCommitOid };
  }
  for (const review of pr.reviews) {
    if (review.state !== 'APPROVED' || !sameLogin(review.author, viewer.login)) {
      continue;
    }
    if (!point || review.submittedAt > point.at) {
      point = { at: review.submittedAt, commitOid: review.commitOid };
    }
  }
  return point;
}

function commitsAfter(pr: Pr, approval: ApprovalPoint | null): Set<string> {
  if (!approval) {
    return new Set();
  }
  const index = pr.commits.findIndex((c) => c.oid === approval.commitOid);
  if (index >= 0) {
    return new Set(pr.commits.slice(index + 1).map((c) => c.oid));
  }
  // Approved commit is gone (force push) or unknown: fall back to time.
  return new Set(pr.commits.filter((c) => c.committedAt > approval.at).map((c) => c.oid));
}

function commitEvents(pr: Pr, viewer: Viewer, userState: UserPrState | null): RawEvent[] {
  const afterApproval = commitsAfter(pr, approvalPoint(pr, viewer, userState));
  return pr.commits.map((commit) => ({
    kind: afterApproval.has(commit.oid) ? 'commits_after_approval' : 'commits_pushed',
    actor: commit.author,
    isBot: isBot(commit.author),
    at: commit.committedAt,
    summary: `${commit.author} pushed: ${oneLine(commit.headline)}`,
    url: null,
    sourceId: commit.oid,
    subject: null,
  }));
}

function viewerWasAsked(pr: Pr, viewer: Viewer): boolean {
  const isViewer = (subject: string | null) => isViewerSubject(subject, viewer);
  const requestedInTimeline = pr.timeline.some((item) => item.kind === 'review_requested' && isViewer(item.subject));
  return requestedInTimeline || pr.reviewerUsers.some(isViewer) || pr.reviewerTeams.some(isViewer);
}

function mergedWithoutViewerReview(pr: Pr, viewer: Viewer): boolean {
  if (sameLogin(pr.author, viewer.login) || !viewerWasAsked(pr, viewer)) {
    return false;
  }
  return !pr.reviews.some((r) => sameLogin(r.author, viewer.login) && r.state !== 'PENDING');
}

function timelineKind(item: TimelineItem, pr: Pr, viewer: Viewer): EventKind {
  switch (item.kind) {
    case 'merged':
      return mergedWithoutViewerReview(pr, viewer) ? 'merged_without_review' : 'merged';
    case 'head_ref_force_pushed':
      return 'force_pushed';
    case 'added_to_merge_queue':
    case 'removed_from_merge_queue':
      return 'merge_queue';
    case 'deployed':
      return 'deploy';
    default:
      return item.kind;
  }
}

const REVIEW_REQUEST_TEXT = [' requested a review from ', ' removed the review request for '];

/**
 * Who a review request (or its removal) names, read back from the summary
 * `timelineSummary` wrote: a login or "org/team-slug". Null for other events.
 */
export function reviewRequestSubject(summary: string): string | null {
  for (const text of REVIEW_REQUEST_TEXT) {
    const index = summary.indexOf(text);
    if (index >= 0) {
      return summary.slice(index + text.length).trim() || null;
    }
  }
  return null;
}

function timelineSummary(item: TimelineItem): string {
  const subject = item.subject ?? 'someone';
  switch (item.kind) {
    case 'review_requested':
      return `${item.actor}${REVIEW_REQUEST_TEXT[0]}${subject}`;
    case 'review_request_removed':
      return `${item.actor}${REVIEW_REQUEST_TEXT[1]}${subject}`;
    case 'head_ref_force_pushed':
      return `${item.actor} force-pushed`;
    case 'added_to_merge_queue':
      return `${item.actor} added it to the merge queue`;
    case 'removed_from_merge_queue':
      return `removed from the merge queue`;
    default:
      return `${item.actor} ${item.kind.replaceAll('_', ' ')}`;
  }
}

function timelineEvents(pr: Pr, viewer: Viewer): RawEvent[] {
  return pr.timeline.map((item) => ({
    kind: timelineKind(item, pr, viewer),
    actor: item.actor,
    isBot: isBot(item.actor),
    at: item.at,
    summary: timelineSummary(item),
    url: null,
    sourceId: item.id,
    subject: item.subject,
  }));
}

/** One line for the latest finished CI result on the head commit. */
function ciEvent(pr: Pr): RawEvent | null {
  const { rollup, contexts } = pr.checks;
  if (rollup !== 'SUCCESS' && rollup !== 'FAILURE') {
    return null;
  }
  const finished = contexts.map((c) => c.completedAt).filter((at): at is string => at !== null);
  if (finished.length === 0) {
    return null;
  }
  const failed = contexts.filter((c) => c.conclusion === 'FAILURE').map((c) => c.name);
  const summary = failed.length > 0 ? `CI failed: ${failed.join(', ')}` : 'CI passed';
  return {
    kind: 'ci',
    actor: '',
    isBot: true,
    at: finished.sort().at(-1) as string,
    summary,
    url: null,
    sourceId: `${pr.headOid}:${rollup}`,
    subject: null,
  };
}

function collectRawEvents(pr: Pr, viewer: Viewer, userState: UserPrState | null): RawEvent[] {
  const raw: RawEvent[] = [];
  for (const comment of pr.comments) {
    const event = commentEvent(comment, pr, viewer);
    if (event) {
      raw.push(event);
    }
  }
  raw.push(...reviewEvents(pr));
  raw.push(...commitEvents(pr, viewer, userState));
  raw.push(...timelineEvents(pr, viewer));
  const ci = ciEvent(pr);
  if (ci) {
    raw.push(ci);
  }
  return raw;
}

export function eventId(prKey: string, kind: EventKind, sourceId: string): string {
  return `${prKey}:${kind}:${sourceId}`;
}

/**
 * Turns a PR snapshot into event lines: comments, reviews, commits, timeline
 * items and CI, each classified by ruleLoudness, oldest first. Returned events
 * have seenAt and override set to null; the store keeps those across syncs.
 */
export function deriveEvents(
  pr: Pr,
  viewer: Viewer,
  userState: UserPrState | null,
): PrEvent[] {
  const events = collectRawEvents(pr, viewer, userState).map((raw): PrEvent => {
    const decision = ruleLoudness({
      kind: raw.kind,
      actor: raw.actor,
      at: raw.at,
      isBot: raw.isBot,
      pr,
      viewer,
      userState,
      subject: raw.subject,
      userRepliedAfter: ADDRESSED_KINDS.includes(raw.kind) && viewerSpokeAfter(pr, viewer, raw.at),
      requestAnswered: requestAnswered(pr, viewer, raw),
    });
    return {
      id: eventId(pr.key, raw.kind, raw.sourceId),
      prKey: pr.key,
      kind: raw.kind,
      actor: raw.actor,
      isBot: raw.isBot,
      at: raw.at,
      summary: raw.summary,
      url: raw.url,
      sourceId: raw.sourceId,
      ruleLoudness: decision.loudness,
      ruleReason: decision.reason,
      override: null,
      seenAt: null,
    };
  });
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
