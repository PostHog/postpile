// The detail pane's activity list: the meaningful events of a PR, with push
// bursts collapsed, people's replies to a bot folded into one quiet line per
// review thread, a bot's review folded with its inline comments, the empty
// reviews GitHub makes for thread replies on their reply's line, and bot
// noise folded into one line. Rules only; the engine and FakeEngine ship the
// result on `PrDetail.activity`, with each event cut down to what a row
// draws (`ActivityEvent`).
import { botReviewOf, foldedBotReviewComments } from './bot-reviews.ts';
import { botThreadOf, threadReplyOf } from './bot-threads.ts';
import { carriedReplies } from './carrier-reviews.ts';
import { oneLine, reviewRequestSubject } from './events.ts';
import { PERSONAL_ASK_KINDS, PUSH_KINDS } from './kinds.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import { findComment, replyTarget } from './reply.ts';
import { effectiveLoudness } from './loudness.ts';
import type { EventDisplayState, EventKind, FullComment, FullPr, IsoTime, NotificationThread, Viewer } from './types.ts';
import type { EventView } from './views.ts';

/** About this many lines show before "Show all N". */
export const ACTIVITY_LINE_CAP = 12;

/**
 * What a person's comment or review on a line can be answered with
 * (2026-10-05): Reply, in its review thread for a code comment, else a new
 * PR comment that quotes it, and a thumbs up.
 */
export interface LineReply {
  /** The comment's or review's id: where the reply and the reaction go. */
  commentId: string;
  author: string;
  /** A code comment: the reply goes into its review thread. */
  inThread: boolean;
  /** The file of a code comment, null otherwise. */
  path: string | null;
  /** A comment or a review with text. An approval without text only takes a reaction. */
  canReply: boolean;
  /** The viewer gave it a thumbs up already. */
  viewerReacted: boolean;
  /** One of its lines asks the viewer personally (mention, question, reply to them): Reply is the emphasized action. */
  asksYou: boolean;
}

/**
 * One event as a row of the pane draws it: glyph by kind, the actor in bold,
 * the summary, its age, the unread dot and why it is loud or quiet in the
 * hover title. The folded bot rows are these; a line adds to it.
 */
export interface ActivityEvent {
  /** The event's id: the row's key, and what Unmute sends for an agent-muted one. */
  id: string;
  kind: EventKind;
  actor: string;
  summary: string;
  at: IsoTime;
  display: EventDisplayState;
  /** The event's own seen state is unseen (`EventView.unseen`): the unread dot. */
  unseen: boolean;
  /** Why the rules, or the agent's override, classed it so. */
  reason: string;
  /** The event's permalink on github.com, the row's age links to it. Null when it has none (timeline items, CI). */
  url: string | null;
}

/** Where a reply in a review thread sits: whom it answers and the file. */
export interface LineThread {
  /** Who it answers: the last other person before it, or the bot that opened a bot thread (`threadReplyOf`). */
  to: string;
  path: string;
}

/**
 * One comment inside a folded line, as its expanded part shows it: a reply
 * in a bot thread, or an inline comment of a bot's review.
 */
export interface FoldedReply {
  /** The comment's id. */
  id: string;
  actor: string;
  at: IsoTime;
  /** A bot-thread reply: its whole body. A bot review's comment: its first line. */
  body: string;
  /** A bot review's comment: its file. Null for a bot-thread reply (the line names the file). */
  path: string | null;
}

/**
 * What a folded line stands for: a person's replies in one bot thread, or a
 * bot's review with its inline comments (2026-10-06).
 */
export type FoldKind = 'bot_thread' | 'bot_review';

/**
 * One line of the list: a single event, a burst of pushes by one person, or
 * a person's replies in one bot thread. Its event fields are the newest
 * event's, except `summary` (a burst says "pushed 3 commits", a bot thread
 * "alice replied to greptile-apps[bot] · 2 replies on src/x.ts"), `actor`
 * (a bot thread: the replier), `display` (loud
 * when any of them is, else the newest's) and `unseen` (any of them is; never
 * on a bot-thread line).
 */
export interface ActivityLine extends ActivityEvent {
  /**
   * The full text of a human comment or review, which `summary` clips to one
   * short line. Null for bots, pushes and everything else.
   */
  body: string | null;
  /** New since you looked: an unseen loud event is in it. */
  isNew: boolean;
  /** How many events the line stands for: more than one for a push burst. */
  eventCount: number;
  /**
   * Reply and thumbs up for a person's comment or review, null for anything
   * else (pushes, bots, lifecycle, the viewer's own words, a comment the
   * snapshot no longer has). A comment on several lines gets it once, on
   * the newest of them.
   */
  reply: LineReply | null;
  /** A reply in a review thread (a bot-thread line too): whom it answers and the file. Null otherwise. */
  thread: LineThread | null;
  /**
   * A quiet folded line (2026-10-06): the replies of a bot thread, or the
   * inline comments of a bot's review, oldest first, which the line expands
   * to. Empty on every other line.
   */
  folded: FoldedReply[];
  /** What a folded line stands for; null on every other line. */
  fold: FoldKind | null;
}

export interface ActivityList {
  /** New since you looked, newest first. */
  fresh: ActivityLine[];
  /** Everything else that matters, newest first. */
  earlier: ActivityLine[];
  /** Bot and CI events, agent-muted ones and review requests between others, newest first. Without `freshNoise`. */
  noise: ActivityEvent[];
  /** The folded noise line: "4 bot events". */
  noiseLabel: string;
  /**
   * The unseen part of the noise since the viewer's last touch, newest first,
   * for the "New since you looked" box. Empty while nothing loud is new.
   */
  freshNoise: ActivityEvent[];
  /** The box's folded noise line: "10 bot comments, CI". */
  freshNoiseLabel: string;
  /** Lines to show before "Show all N" (ACTIVITY_LINE_CAP). */
  cap: number;
  /**
   * The tile is unread because GitHub updated the notification and no event
   * explains it (the thread reason "new activity on GitHub"): when GitHub did
   * it. The pane shows one dotted line at the top. Null otherwise.
   */
  threadChangedAt: IsoTime | null;
}

const HUMAN_TALK: EventKind[] = [
  'comment',
  'comment_edited',
  'reply_to_user',
  'question_to_user',
  'mention',
  'team_mention',
  'review_approved',
  'review_changes_requested',
  'review_commented',
];

const LIFECYCLE: EventKind[] = ['ready_for_review', 'converted_to_draft', 'merged', 'merged_without_review', 'closed', 'reopened'];

const REVIEW_REQUESTS: EventKind[] = ['review_requested', 'review_request_removed'];

/** A review request (or its removal) naming the viewer or one of their teams. */
function involvesViewer(view: EventView, viewer: Viewer | null): boolean {
  const subject = reviewRequestSubject(view.event.summary);
  if (!viewer || subject === null) {
    return false;
  }
  return sameLogin(subject, viewer.login) || isOwnTeam(subject, viewer.teams);
}

/**
 * The bot review a quiet bot event folds into (`botReviewOf`), null for
 * none. A loud (raised) or muted one stays with the other bot events.
 */
function foldedBotReviewId(view: EventView, pr: FullPr | null, viewer: Viewer | null): string | null {
  if (!pr || effectiveLoudness(view.event) !== 'quiet') {
    return null;
  }
  return botReviewOf(view.event, pr, viewer)?.id ?? null;
}

/** Human talk, review requests about you or your team, human pushes, lifecycle, and a bot's folded review. */
function isMeaningful(view: EventView, viewer: Viewer | null, pr: FullPr | null): boolean {
  const { event } = view;
  if (view.display === 'muted') {
    return false;
  }
  if (foldedBotReviewId(view, pr, viewer) !== null) {
    return true;
  }
  if (LIFECYCLE.includes(event.kind)) {
    return true;
  }
  if (REVIEW_REQUESTS.includes(event.kind)) {
    return involvesViewer(view, viewer);
  }
  if (event.isBot) {
    return false;
  }
  return HUMAN_TALK.includes(event.kind) || PUSH_KINDS.includes(event.kind);
}

function isPush(view: EventView): boolean {
  return PUSH_KINDS.includes(view.event.kind);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "rowan pushed 3 commits", "... after your approval" when any came after it. */
function burstSummary(actor: string, events: EventView[]): string {
  const afterApproval = events.some((view) => view.event.kind === 'commits_after_approval');
  const forced = events.filter((view) => view.event.kind === 'force_pushed').length;
  const commits = events.length - forced;
  const parts = [commits > 0 ? `pushed ${plural(commits, 'commit')}` : '', forced > 0 ? `force-pushed${forced > 1 ? ` ${forced} times` : ''}` : ''];
  const text = parts.filter((part) => part !== '').join(' and ');
  return `${actor} ${text}${afterApproval ? ' after your approval' : ''}`;
}

/** Events oldest first, grouped: consecutive pushes by one person make one group. */
function groupBursts(events: EventView[]): EventView[][] {
  const groups: EventView[][] = [];
  for (const view of events) {
    const last = groups[groups.length - 1];
    const lastView = last?.[last.length - 1];
    if (last && lastView && isPush(view) && isPush(lastView) && sameLogin(lastView.event.actor, view.event.actor)) {
      last.push(view);
    } else {
      groups.push([view]);
    }
  }
  return groups;
}

/** The full body behind a human comment or review event; bots keep the one-line summary. */
function fullBody(view: EventView, pr: FullPr | null): string | null {
  const { event } = view;
  if (!pr || event.isBot || !HUMAN_TALK.includes(event.kind)) {
    return null;
  }
  const comment = pr.comments.find((c) => c.id === event.sourceId);
  const review = pr.reviews.find((r) => r.id === event.sourceId);
  const body = (comment?.body ?? review?.body ?? '').trim();
  return body === '' ? null : body;
}

/** An event as a row draws it, without what no row reads (source id, rule loudness, seen time). */
export function activityEvent(view: EventView): ActivityEvent {
  const { event } = view;
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actor,
    summary: event.summary,
    at: event.at,
    display: view.display,
    unseen: view.unseen,
    reason: event.override?.reason ?? event.ruleReason,
    url: event.url,
  };
}

/**
 * A line while the list is built: the line, and its events newest first for
 * the reply rules. A folded line (a bot thread) takes no reply.
 */
interface LineDraft {
  line: ActivityLine;
  events: EventView[];
  folded: boolean;
}

const THREAD_TALK: EventKind[] = ['comment', 'reply_to_user', 'question_to_user', 'mention', 'team_mention'];

/** The thread a single comment's line answers in, null for anything else. */
function lineThread(view: EventView, pr: FullPr | null): LineThread | null {
  if (!pr || !THREAD_TALK.includes(view.event.kind)) {
    return null;
  }
  const comment = findComment(pr, view.event.sourceId);
  const reply = comment ? threadReplyOf(comment, pr) : null;
  return reply === null ? null : { to: reply.to, path: reply.path };
}

function toDraft(group: EventView[], pr: FullPr | null): LineDraft {
  const newestFirst = group.toReversed();
  const newest = newestFirst[0]!;
  const loud = group.some((view) => view.display === 'loud');
  const line: ActivityLine = {
    ...activityEvent(newest),
    summary: group.length > 1 ? burstSummary(newest.event.actor, group) : newest.event.summary,
    display: loud ? 'loud' : newest.display,
    unseen: group.some((view) => view.unseen),
    body: group.length > 1 ? null : fullBody(newest, pr),
    isNew: loud,
    eventCount: group.length,
    reply: null,
    thread: group.length > 1 ? null : lineThread(newest, pr),
    folded: [],
    fold: null,
  };
  return { line, events: newestFirst, folded: false };
}

const BOT_REVIEW_KEY = 'bot-review:';

/**
 * Which folded line an event goes to, null for none. Events of one fold need
 * not be next to each other. A bot's quiet review, its inline comments and
 * their edits make one line per review (`bot-review:<reviewId>`). A
 * person's quiet reply to a bot in a review thread and its edit make one
 * line per thread (`bot-thread:<threadId>`, `botThreadOf`); a loud one (an
 * ask, or the agent raised it) stays a line of its own.
 */
function foldKeyOf(view: EventView, pr: FullPr | null, viewer: Viewer | null): string | null {
  const reviewId = foldedBotReviewId(view, pr, viewer);
  if (reviewId !== null) {
    return `${BOT_REVIEW_KEY}${reviewId}`;
  }
  if (!pr || view.event.kind === 'review_commented' || effectiveLoudness(view.event) === 'loud') {
    return null;
  }
  const threadId = botThreadOf(view.event, pr);
  return threadId === null ? null : `bot-thread:${threadId}`;
}

/** The replies an empty review only carries (GitHub makes one per thread reply), by comment id; empty for any other event. */
function carriedIds(view: EventView, pr: FullPr | null): string[] {
  if (!pr || view.event.kind !== 'review_commented') {
    return [];
  }
  const review = pr.reviews.find((candidate) => candidate.id === view.event.sourceId);
  return review ? carriedReplies(review, pr).map((comment) => comment.id) : [];
}

/** The thread comments a fold's events stand for, oldest first. */
function foldedComments(group: EventView[], pr: FullPr): FullComment[] {
  const ids = new Set(group.map((view) => view.event.sourceId));
  return pr.comments.filter((comment) => ids.has(comment.id));
}

/**
 * One quiet line for a person's replies in one bot thread (2026-10-06):
 * "alice replied to greptile-apps[bot] · 2 replies on src/x.ts", the bodies
 * folded under it. Always one person: a second one joining is no bot
 * conversation any more (`isBotThreadReply`). Never new since you looked
 * and no unread dot: answering a bot is housekeeping. No Reply on it
 * either; the thread is on GitHub.
 */
function botThreadDraft(group: EventView[], pr: FullPr): LineDraft {
  const newestFirst = group.toReversed();
  const newest = newestFirst[0]!;
  const replies = foldedComments(group, pr);
  const first = replies[0];
  const where = first ? threadReplyOf(first, pr) : null;
  const actor = first?.author ?? newest.event.actor;
  const count = replies.length > 1 ? ` · ${replies.length} replies` : '';
  const to = where?.to ?? 'a bot';
  const path = where?.path ?? '';
  const line: ActivityLine = {
    ...activityEvent(newest),
    kind: 'comment',
    actor,
    summary: `${actor} replied to ${to}${count}${path === '' ? '' : ` on ${path}`}`,
    display: group.some((view) => view.display === 'quiet') ? 'quiet' : newest.display,
    unseen: false,
    reason: 'replies to a bot in a review thread',
    body: null,
    isNew: false,
    eventCount: group.length,
    reply: null,
    thread: where === null ? null : { to: where.to, path: where.path },
    folded: replies.map((comment) => ({ id: comment.id, actor: comment.author, at: comment.createdAt, body: comment.body.trim(), path: null })),
    fold: 'bot_thread',
  };
  return { line, events: newestFirst, folded: true };
}

/**
 * One quiet line for a bot's review and its inline comments (2026-10-06):
 * "greptile-apps[bot] reviewed · 6 inline comments", each comment's file
 * and first line folded under it. Like other bot events: never new since
 * you looked, no unread dot, no Reply.
 */
function botReviewDraft(group: EventView[], reviewId: string, pr: FullPr, viewer: Viewer | null): LineDraft {
  const newestFirst = group.toReversed();
  const newest = newestFirst[0]!;
  const review = pr.reviews.find((candidate) => candidate.id === reviewId);
  const comments = review ? foldedBotReviewComments(review, pr, viewer) : [];
  const actor = review?.author ?? newest.event.actor;
  const line: ActivityLine = {
    ...activityEvent(newest),
    kind: 'review_commented',
    actor,
    summary: `${actor} reviewed · ${plural(comments.length, 'inline comment')}`,
    display: group.some((view) => view.display === 'quiet') ? 'quiet' : newest.display,
    unseen: false,
    reason: 'a bot review with its inline comments',
    body: null,
    isNew: false,
    eventCount: group.length,
    reply: null,
    thread: null,
    folded: comments.map((comment) => ({ id: comment.id, actor: comment.author, at: comment.createdAt, body: oneLine(comment.body), path: comment.path })),
    fold: 'bot_review',
  };
  return { line, events: newestFirst, folded: true };
}

/** The folded line of one key (`foldKeyOf`). */
function foldDraft(key: string, group: EventView[], pr: FullPr, viewer: Viewer | null): LineDraft {
  return key.startsWith(BOT_REVIEW_KEY) ? botReviewDraft(group, key.slice(BOT_REVIEW_KEY.length), pr, viewer) : botThreadDraft(group, pr);
}

/**
 * The empty review GitHub made for a thread reply joins the reply's line (a
 * bot-thread fold, the ask's or the comment's own line) instead of saying
 * "alice reviewed" a second time, in any thread. Returns the carriers whose
 * reply has no line (a muted reply): they go to the noise. One the agent or
 * the user raised to loud keeps a line of its own (`lineDrafts` never
 * passes it).
 */
function addCarriers(drafts: LineDraft[], carriers: EventView[], pr: FullPr | null): EventView[] {
  const homeless: EventView[] = [];
  for (const carrier of carriers) {
    const ids = carriedIds(carrier, pr);
    const home = drafts.find((draft) => draft.events.some((view) => view.event.kind !== 'review_commented' && ids.includes(view.event.sourceId)));
    if (home === undefined) {
      homeless.push(carrier);
      continue;
    }
    home.events.push(carrier);
    home.line.eventCount += 1;
    if (!home.folded && carrier.unseen) {
      home.line.unseen = true;
    }
  }
  return homeless;
}

interface Drafts {
  /** The lines, oldest first. */
  drafts: LineDraft[];
  /** Empty reviews that only carry a reply without a line: noise. */
  homeless: EventView[];
}

/**
 * The lines of the meaningful events, oldest first: folds (one per key, at
 * its newest event), the rest with push bursts grouped, and the reviews
 * that only carry a reply on that reply's line.
 */
function lineDrafts(meaningful: EventView[], pr: FullPr | null, viewer: Viewer | null): Drafts {
  const folds = new Map<string, EventView[]>();
  const carriers: EventView[] = [];
  const rest: EventView[] = [];
  for (const view of meaningful) {
    const key = foldKeyOf(view, pr, viewer);
    if (key !== null) {
      folds.set(key, [...(folds.get(key) ?? []), view]);
    } else if (effectiveLoudness(view.event) !== 'loud' && carriedIds(view, pr).length > 0) {
      carriers.push(view);
    } else {
      rest.push(view);
    }
  }
  const drafts = groupBursts(rest).map((group) => toDraft(group, pr));
  if (pr) {
    drafts.push(...[...folds.entries()].map(([key, group]) => foldDraft(key, group, pr, viewer)));
  }
  const homeless = addCarriers(drafts, carriers, pr);
  return { drafts: drafts.toSorted((a, b) => (a.line.at < b.line.at ? -1 : a.line.at > b.line.at ? 1 : 0)), homeless };
}

/** The reply of one line on its own: its newest event's comment or review. */
function lineReply(draft: LineDraft, pr: FullPr, viewer: Viewer): LineReply | null {
  const newest = draft.events[0]?.event;
  if (!newest || newest.isBot || !HUMAN_TALK.includes(newest.kind) || sameLogin(newest.actor, viewer.login)) {
    return null;
  }
  const asksYou = draft.events.some((view) => PERSONAL_ASK_KINDS.includes(view.event.kind));
  const comment = findComment(pr, newest.sourceId);
  if (comment) {
    const inThread = replyTarget(comment).kind === 'thread';
    return { commentId: comment.id, author: comment.author, inThread, path: inThread ? comment.path : null, canReply: true, viewerReacted: comment.viewerReacted ?? false, asksYou };
  }
  const review = pr.reviews.find((candidate) => candidate.id === newest.sourceId);
  if (review) {
    return { commentId: review.id, author: review.author, inThread: false, path: null, canReply: false, viewerReacted: review.viewerReacted ?? false, asksYou };
  }
  return null;
}

/**
 * The lines, newest first, with their replies. A comment can show on more
 * than one line (its event and a later edit, a review and the mention in its
 * body); only the newest gets the reply, so one comment never has two Reply
 * boxes, and it asks the viewer when any of its lines does.
 */
function withReplies(drafts: LineDraft[], pr: FullPr | null, viewer: Viewer | null): ActivityLine[] {
  const lines = drafts.map((draft) => draft.line);
  if (!pr || !viewer) {
    return lines;
  }
  const replies = drafts.map((draft) => (draft.folded ? null : lineReply(draft, pr, viewer)));
  const owner = new Map<string, number>();
  replies.forEach((reply, index) => {
    if (reply && !owner.has(reply.commentId)) {
      owner.set(reply.commentId, index);
    }
  });
  return lines.map((line, index) => {
    const reply = replies[index];
    if (!reply || owner.get(reply.commentId) !== index) {
      return line;
    }
    const asksYou = replies.some((other) => other?.commentId === reply.commentId && other.asksYou);
    return { ...line, reply: { ...reply, asksYou } };
  });
}

function byTime(a: EventView, b: EventView): number {
  return a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : 0;
}

/** "4 bot events", or "4 quiet events" when review requests between others are in it; empty for none. */
export function noiseLabel(noise: EventView[]): string {
  if (noise.length === 0) {
    return '';
  }
  const machineKinds: EventKind[] = ['deploy', 'merge_queue', 'bot_comment'];
  const machine = noise.every((view) => view.event.isBot || machineKinds.includes(view.event.kind));
  const events = noise.length === 1 ? 'event' : 'events';
  return machine ? `${noise.length} bot ${events}` : `${noise.length} quiet ${events}`;
}

function countWord(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}

/**
 * The noise by what it is, for the "New since you looked" box: "10 bot
 * comments", "2 bot pushes, a deploy, merge queue, 1 other".
 */
export function noiseSummary(noise: EventView[]): string {
  const count = (test: (view: EventView) => boolean) => noise.filter(test).length;
  const isKind = (kinds: EventKind[]) => (view: EventView) => kinds.includes(view.event.kind);
  const comments = count((view) => view.event.kind === 'bot_comment' || (view.event.isBot && HUMAN_TALK.includes(view.event.kind)));
  const pushes = count((view) => view.event.isBot && PUSH_KINDS.includes(view.event.kind));
  const deploys = count(isKind(['deploy']));
  const queue = count(isKind(['merge_queue']));
  const other = noise.length - comments - pushes - deploys - queue;
  const parts = [
    comments > 0 ? countWord(comments, 'bot comment') : '',
    pushes > 0 ? countWord(pushes, 'bot push', 'bot pushes') : '',
    deploys > 0 ? (deploys === 1 ? 'a deploy' : `${deploys} deploys`) : '',
    queue > 0 ? 'merge queue' : '',
    other > 0 ? `${other} other` : '',
  ];
  return parts.filter((part) => part !== '').join(', ');
}

/**
 * When GitHub changed an unread notification thread that no event explains:
 * nothing unseen and loud, and no unseen quiet event since the thread's last
 * read. Mirrors the tile's thread reason (`threadReasons` in tiles.ts), which
 * then says "new activity on GitHub".
 */
export function threadChangedAt(thread: NotificationThread | null, events: EventView[]): IsoTime | null {
  if (!thread || !thread.unread) {
    return null;
  }
  const explains = (view: EventView) => {
    const { event } = view;
    if (event.seenAt !== null) {
      return false;
    }
    const loudness = effectiveLoudness(event);
    return loudness === 'loud' || (loudness === 'quiet' && (thread.lastReadAt === null || event.at > thread.lastReadAt));
  };
  return events.some(explains) ? null : thread.updatedAt;
}

/**
 * The activity list for one PR. Meaningful events: human comments and
 * reviews, mentions, review requests naming you or your team, human pushes
 * (a burst by one person is one line), and lifecycle (ready, draft, merged,
 * closed, reopened). With `pr`, people's quiet replies to a bot in a review
 * thread fold into one line per thread, a bot's quiet review with its inline
 * comments into one line per review (`folded`, `fold`), the empty review
 * GitHub makes for a thread reply joins the reply's line, and a single
 * thread reply says whom it answers (`thread`). The rest (bots, CI, deploys,
 * merge queue, agent-muted events, review requests between others) goes to
 * `noise`.
 *
 * While something loud is new, the unseen noise after `since` (the viewer's
 * last touch, `whatsNew().anchor.at`; null for a first look) moves to
 * `freshNoise`, so the box and the list below never show it twice.
 *
 * With `pr`, lines of human comments and reviews carry the full `body`.
 * With `thread` (the PR's notification thread), `threadChangedAt` says when an
 * unread thread changed without an event to show for it.
 */
export function activityList(
  events: EventView[],
  viewer: Viewer | null,
  since: IsoTime | null = null,
  pr: FullPr | null = null,
  thread: NotificationThread | null = null,
): ActivityList {
  const sorted = events.toSorted(byTime);
  const meaningful = sorted.filter((view) => isMeaningful(view, viewer, pr));
  const { drafts, homeless } = lineDrafts(meaningful, pr, viewer);
  const isNoise = (view: EventView) => !isMeaningful(view, viewer, pr) || homeless.includes(view);
  const allNoise = sorted.filter(isNoise).toReversed();
  const lines = withReplies(drafts.toReversed(), pr, viewer);
  const fresh = lines.filter((line) => line.isNew);
  const isFreshNoise = (view: EventView) => fresh.length > 0 && view.display !== 'seen' && (since === null || view.event.at > since);
  const freshNoise = allNoise.filter(isFreshNoise);
  const noise = allNoise.filter((view) => !isFreshNoise(view));
  return {
    fresh,
    earlier: lines.filter((line) => !line.isNew),
    noise: noise.map(activityEvent),
    noiseLabel: noiseLabel(noise),
    freshNoise: freshNoise.map(activityEvent),
    freshNoiseLabel: noiseSummary(freshNoise),
    cap: ACTIVITY_LINE_CAP,
    threadChangedAt: threadChangedAt(thread, events),
  };
}
