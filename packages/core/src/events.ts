import { trimBotBody } from './bot-bodies.ts';
import { isBotCommand } from './bot-talk.ts';
import { isBotThreadReply, threadReplyOf } from './bot-threads.ts';
import { isBot, isMachineComment } from './bots.ts';
import { isCarrierReview } from './carrier-reviews.ts';
import { ADDRESSED_KINDS } from './kinds.ts';
import { lastSpokeAt, spokeAfter } from './last-touch.ts';
import { ruleLoudness } from './loudness.ts';
import { mentionsAnyTeam, mentionsTeam, mentionsUser, sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { homeTeamsOf, isRoutingTeam, teamsHomeFirst } from './team-roles.ts';
import { viewerAskedToReview } from './review-request.ts';
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
  /** comment_edited: the edit time, part of the event id so a later edit is a new event. */
  version?: IsoTime;
  /** A person's reply to a bot in a review thread (`bot-threads.ts`). */
  botThreadReply?: boolean;
  /** An empty review GitHub made to carry thread replies (`carrier-reviews.ts`). */
  carrierReview?: boolean;
  /** A person's command for a bot, "@codex review" (`isBotCommand`). */
  botCommand?: boolean;
  /** Bot talk that asks the viewer nothing, an edit of it, or a carrier review (`PrEvent.chatter`). */
  chatter?: boolean;
}

interface ApprovalPoint {
  at: IsoTime;
  commitOid: string | null;
}

const deployBody = /\b(deploy(ed|ment)?|preview)\b/i;

/** The first line with text, HTML comments (bot markers) removed and whitespace collapsed. */
export function oneLine(text: string, max = 100): string {
  const visible = text.replace(/<!--[\s\S]*?-->/g, '');
  const line = visible.split('\n').find((part) => part.trim() !== '') ?? '';
  const trimmed = line.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function withText(prefix: string, body: string): string {
  const text = oneLine(body);
  return text === '' ? prefix : `${prefix}: ${text}`;
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
  const reviewedAfter = spokeAfter(pr, viewer.login, raw.at, { reviewsOnly: true });
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

/**
 * The team a team mention names, home teams first: its loudness depends on
 * the team's role (a routing team's mention is FYI, 2026-09-30).
 */
function mentionedTeam(comment: Comment, viewer: Viewer): string | null {
  return teamsHomeFirst(viewer).find((team) => mentionsTeam(comment.body, team)) ?? null;
}

/**
 * A team mention that names only teams routing reviews to the viewer, none
 * of their home teams: FYI, never an ask (DESIGN.md "Team roles").
 */
export function isRoutingTeamMention(event: Pick<PrEvent, 'kind' | 'sourceId'>, pr: Pr, viewer: Viewer): boolean {
  if (event.kind !== 'team_mention') {
    return false;
  }
  const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
  const team = comment ? mentionedTeam(comment, viewer) : null;
  return team !== null && isRoutingTeam(team, viewer);
}

/** "alice commented", or for a reply in a review thread "alice replied to greptile-apps[bot] on src/x.ts". */
function plainCommentLead(comment: Comment, pr: Pr): string {
  const reply = threadReplyOf(comment, pr);
  return reply === null ? `${comment.author} commented` : `${comment.author} replied to ${reply.to} on ${reply.path}`;
}

function commentSummary(kind: EventKind, comment: Comment, pr: Pr): string {
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
      return withText(plainCommentLead(comment, pr), comment.body);
  }
}

/**
 * A person's bot talk (a reply in a bot-only thread, a bot command) that
 * asks the viewer nothing: a mention, a question or a reply to them keeps
 * its own kind and its own weight. The viewer's own counts too.
 */
function isChatterComment(comment: Comment, pr: Pr, viewer: Viewer): boolean {
  if (isMachineComment(comment)) {
    return false;
  }
  const asks = !sameLogin(comment.author, viewer.login) && addressedKind(comment, pr, viewer) !== null;
  return !asks && (isBotThreadReply(comment, pr) || isBotCommand(comment));
}

function commentEvent(comment: Comment, pr: Pr, viewer: Viewer): RawEvent | null {
  const machine = isMachineComment(comment);
  let kind: EventKind | null;
  if (machine) {
    // Only the part of a bot's body PostPile keeps: a snapshot stored before
    // bodies were cut must derive the same kind (part of the event id) as one cut on save.
    kind = deployBody.test(trimBotBody(comment)) ? 'deploy' : 'bot_comment';
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
    summary: commentSummary(finalKind, comment, pr),
    url: comment.url,
    sourceId: comment.id,
    subject: finalKind === 'team_mention' ? mentionedTeam(comment, viewer) : null,
    botThreadReply: finalKind === 'comment' && isBotThreadReply(comment, pr),
    botCommand: finalKind === 'comment' && isBotCommand(comment),
    chatter: finalKind === 'comment' && isChatterComment(comment, pr, viewer),
  };
}

/** The comment was edited after it was posted. A review body edited while the review was still pending does not count. */
function editedAt(comment: Comment): IsoTime | null {
  const at = comment.lastEditedAt ?? null;
  return at !== null && at > comment.createdAt ? at : null;
}

/** Who made the latest edit: the editor, else the author (GitHub does not always say). */
function editorOf(comment: Comment): string {
  return comment.editor || comment.author;
}

/**
 * An edit is automation when a bot account made it, or when the author
 * edited their own comment and the comment is automation (a bot body on a
 * user account).
 */
function isMachineEdit(comment: Comment): boolean {
  const editor = editorOf(comment);
  return sameLogin(editor, comment.author) ? isMachineComment(comment) : isBot(editor);
}

/**
 * Whom a person's edited comment now @-mentions: the viewer, else one of
 * their home teams; null for none, and for automation or the viewer's own
 * edits. The old body is not fetched, so a mention that was there before the
 * edit counts too: the edit event is new and unseen only when the edit came
 * after the viewer's last read (DESIGN.md "Handled quietly" › Comment edits).
 */
function editMentionTarget(comment: Comment, viewer: Viewer): string | null {
  if (isMachineEdit(comment) || sameLogin(editorOf(comment), viewer.login)) {
    return null;
  }
  if (mentionsUser(comment.body, viewer.login)) {
    return viewer.login;
  }
  return homeTeamsOf(viewer).find((team) => mentionsTeam(comment.body, team)) ?? null;
}

/**
 * What a comment_edited event asks of the viewer: 'you' when a person's
 * edited comment now mentions them, 'team' when it mentions one of their
 * home teams, null otherwise (other kinds, automation, no mention). One
 * home for loudness, asks, pings and the headline.
 */
export function editMentionOf(event: Pick<PrEvent, 'kind' | 'sourceId'>, pr: Pr, viewer: Viewer): 'you' | 'team' | null {
  if (event.kind !== 'comment_edited') {
    return null;
  }
  const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
  const target = comment ? editMentionTarget(comment, viewer) : null;
  if (target === null) {
    return null;
  }
  return sameLogin(target, viewer.login) ? 'you' : 'team';
}

function editSummary(comment: Comment, editor: string, machine: boolean, target: string | null, viewer: Viewer): string {
  if (machine && sameLogin(editor, comment.author)) {
    return withText(`${editor} updated its comment`, comment.body);
  }
  if (target === null) {
    return withText(`${editor} edited a comment`, comment.body);
  }
  const whom = sameLogin(target, viewer.login) ? 'you' : 'your team';
  return withText(`${editor} edited a comment to mention ${whom}`, comment.body);
}

/** One event for a comment's latest edit, at the edit time; null for a comment never edited. An edit of chatter that mentions nobody is chatter too. */
function editEvent(comment: Comment, pr: Pr, viewer: Viewer): RawEvent | null {
  const at = editedAt(comment);
  if (at === null) {
    return null;
  }
  const editor = editorOf(comment);
  const machine = isMachineEdit(comment);
  const target = editMentionTarget(comment, viewer);
  return {
    kind: 'comment_edited',
    actor: editor,
    isBot: machine,
    at,
    summary: editSummary(comment, editor, machine, target, viewer),
    url: comment.url,
    sourceId: comment.id,
    subject: target,
    version: at,
    chatter: !machine && target === null && isChatterComment(comment, pr, viewer),
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
      carrierReview: isCarrierReview(review, pr),
      chatter: isCarrierReview(review, pr),
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

function mergedWithoutViewerReview(pr: Pr, viewer: Viewer): boolean {
  if (isPrOwner(pr, viewer.login) || !viewerAskedToReview(pr, viewer)) {
    return false;
  }
  return lastSpokeAt(pr, viewer.login, { reviewsOnly: true }) === null;
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
 * Only for the activity list, which may have no PR at hand; rules read the
 * target as data (`reviewRequestTarget`).
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

function collectRawEvents(pr: Pr, viewer: Viewer, userState: UserPrState | null): RawEvent[] {
  const raw: RawEvent[] = [];
  for (const comment of pr.comments) {
    const event = commentEvent(comment, pr, viewer);
    if (event) {
      raw.push(event);
    }
    const edit = editEvent(comment, pr, viewer);
    if (edit) {
      raw.push(edit);
    }
  }
  raw.push(...reviewEvents(pr));
  raw.push(...commitEvents(pr, viewer, userState));
  raw.push(...timelineEvents(pr, viewer));
  return raw;
}

export function eventId(prKey: string, kind: EventKind, sourceId: string): string {
  return `${prKey}:${kind}:${sourceId}`;
}

/** A comment_edited event's id: the comment and the edit time, so re-syncs keep it and a later edit is a new one. */
export function editEventId(prKey: string, commentId: string, editedAt: IsoTime): string {
  return eventId(prKey, 'comment_edited', `${commentId}@${editedAt}`);
}

/**
 * A machine comment's event id under its other kind: deploy and
 * bot_comment of one comment are one event, renamed when the kept part of
 * its body starts or stops saying "deploy" (store `EventRepo.upsertDerived`).
 * Null for any other id. A PR key ("owner/repo#1") holds no colon, so the
 * kind is what sits between the first two.
 */
export function machineCommentTwinId(id: string): string | null {
  const kindStart = id.indexOf(':') + 1;
  const kindEnd = id.indexOf(':', kindStart);
  if (kindStart === 0 || kindEnd === -1) {
    return null;
  }
  const kind = id.slice(kindStart, kindEnd);
  const twin = kind === 'deploy' ? 'bot_comment' : kind === 'bot_comment' ? 'deploy' : null;
  return twin === null ? null : `${id.slice(0, kindStart)}${twin}${id.slice(kindEnd)}`;
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
      userRepliedAfter: (ADDRESSED_KINDS.includes(raw.kind) || raw.kind === 'comment_edited') && spokeAfter(pr, viewer.login, raw.at),
      requestAnswered: requestAnswered(pr, viewer, raw),
      botThreadReply: raw.botThreadReply === true,
      carrierReview: raw.carrierReview === true,
      botCommand: raw.botCommand === true,
    });
    return {
      id: raw.version === undefined ? eventId(pr.key, raw.kind, raw.sourceId) : editEventId(pr.key, raw.sourceId, raw.version),
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
      chatter: raw.chatter === true,
      override: null,
      seenAt: null,
    };
  });
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
