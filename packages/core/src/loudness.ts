import { isAutomation } from './bots.ts';
import { CHANGES_ANSWERED_REASON, isChangesAnswerEvent } from './changes-answered.ts';
import { ADDRESSED_KINDS, PUSH_KINDS } from './kinds.ts';
import { isViewerSubject, sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { viewerAskedToReview } from './review-request.ts';
import { isRoutingTeam } from './team-roles.ts';
import type { EventDisplayState, EventKind, IsoTime, Loudness, Pr, PrEvent, UserPrState, Viewer } from './types.ts';

export interface LoudnessInput {
  kind: EventKind;
  /** Login of whoever caused the event. */
  actor: string;
  /** When it happened. Without it, time-based rules (addressed your changes) do not apply. */
  at?: IsoTime;
  isBot: boolean;
  pr: Pr;
  viewer: Viewer;
  userState: UserPrState | null;
  /**
   * review_requested / review_request_removed: login or "org/team-slug".
   * team_mention: the team mentioned. comment_edited: the viewer or home
   * team a person's edited comment now mentions (`editMentionOf`), else null.
   */
  subject?: string | null;
  /** The viewer already spoke on the PR after this event, so it is handled. */
  userRepliedAfter?: boolean;
  /** review_requested: the viewer reviewed after it, or the request was removed later. */
  requestAnswered?: boolean;
}

export interface LoudnessDecision {
  loudness: Loudness;
  reason: string;
}

// Machine activity that never needs a person: shown with a dot at most.
const machineKinds: EventKind[] = ['ci', 'deploy', 'merge_queue', 'bot_comment'];

const reviewKinds: EventKind[] = ['review_approved', 'review_changes_requested', 'review_commented'];

function isViewersPr(input: LoudnessInput): boolean {
  return isPrOwner(input.pr, input.viewer.login);
}

function isOpenDraft(input: LoudnessInput): boolean {
  return input.pr.isDraft && input.pr.state === 'OPEN';
}

function isMachineActivity(input: LoudnessInput): boolean {
  return isAutomation(input, input.subject ?? null, input.viewer) || machineKinds.includes(input.kind);
}

/** A person's comment edit that now mentions the viewer or a home team (automation never gets here). */
function isMentionEdit(input: LoudnessInput): boolean {
  return input.kind === 'comment_edited' && typeof input.subject === 'string';
}

function isRequestForViewer(input: LoudnessInput): boolean {
  return input.kind === 'review_requested' && isViewerSubject(input.subject, input.viewer);
}

/** One row of the loudness table: a named condition, what it decides, and why. */
export interface LoudnessRow {
  name: string;
  when: (input: LoudnessInput) => boolean;
  loudness: Loudness;
  reason: string | ((input: LoudnessInput) => string);
}

/**
 * The loudness decision as a table. Read top to bottom, first match wins, so
 * the order is the precedence: who did it first, then what happened. The last
 * row matches everything, so there is always an answer.
 * The machine rows use `isAutomation`: it skips review requests aimed at the
 * viewer or their team, whoever clicked them.
 */
export const LOUDNESS_TABLE: readonly LoudnessRow[] = [
  {
    name: 'own activity',
    when: (input) => input.actor !== '' && sameLogin(input.actor, input.viewer.login),
    loudness: 'quiet',
    reason: 'your own activity',
  },
  {
    // A bot rebasing or updating a draft is pure churn; nobody reviews drafts.
    name: 'bot push to a draft',
    when: (input) => isMachineActivity(input) && input.isBot && PUSH_KINDS.includes(input.kind) && input.pr.isDraft,
    loudness: 'muted',
    reason: 'bot pushed to a draft',
  },
  {
    name: 'machine activity',
    when: isMachineActivity,
    loudness: 'quiet',
    reason: 'bot activity',
  },
  {
    name: 'addressed, already replied',
    when: (input) => (ADDRESSED_KINDS.includes(input.kind) || isMentionEdit(input)) && input.userRepliedAfter === true,
    loudness: 'quiet',
    reason: 'you already replied',
  },
  {
    name: 'mention',
    when: (input) => input.kind === 'mention',
    loudness: 'loud',
    reason: 'mentions you',
  },
  {
    // A routing team only routes work to the viewer; its mention keeps them posted (2026-09-30).
    name: 'routing team mention',
    when: (input) => input.kind === 'team_mention' && typeof input.subject === 'string' && isRoutingTeam(input.subject, input.viewer),
    loudness: 'quiet',
    reason: 'mentions a team that only routes reviews to you',
  },
  {
    name: 'team mention',
    when: (input) => input.kind === 'team_mention',
    loudness: 'loud',
    reason: 'mentions your team',
  },
  {
    name: 'reply to you',
    when: (input) => input.kind === 'reply_to_user',
    loudness: 'loud',
    reason: 'replies to you',
  },
  {
    name: 'question to you',
    when: (input) => ADDRESSED_KINDS.includes(input.kind),
    loudness: 'loud',
    reason: 'asks you a question',
  },
  {
    // The old body is not fetched: an edit after the viewer's last read that mentions them counts as a new ask (DESIGN "Handled quietly" › Comment edits).
    name: 'edit mentions you',
    when: isMentionEdit,
    loudness: 'loud',
    reason: (input) => (sameLogin(input.subject ?? '', input.viewer.login) ? 'edited to mention you' : 'edited to mention your team'),
  },
  {
    // A person fixing a typo or adding a line: quiet, the events agent judges it on an unread thread.
    name: 'edited comment',
    when: (input) => input.kind === 'comment_edited',
    loudness: 'quiet',
    reason: 'edited a comment',
  },
  {
    // The author pushed or replied after the viewer asked for changes: that is aimed at the viewer.
    name: 'author answered your changes request',
    when: (input) =>
      input.at !== undefined &&
      isChangesAnswerEvent({ kind: input.kind, actor: input.actor, at: input.at }, input.pr, input.viewer),
    loudness: 'loud',
    reason: CHANGES_ANSWERED_REASON,
  },
  {
    name: 'review on your PR',
    when: (input) => reviewKinds.includes(input.kind) && isViewersPr(input),
    loudness: 'loud',
    reason: 'review on your PR',
  },
  {
    name: 'review on someone else\'s PR',
    when: (input) => reviewKinds.includes(input.kind),
    loudness: 'quiet',
    reason: 'review by someone else',
  },
  {
    // A draft is not up for review yet; marking it ready is what calls for a look.
    name: 'review requested from you on a draft',
    when: (input) => isRequestForViewer(input) && isOpenDraft(input),
    loudness: 'quiet',
    reason: 'review requested on a draft',
  },
  {
    name: 'review request already answered',
    when: (input) => isRequestForViewer(input) && input.requestAnswered === true,
    loudness: 'quiet',
    reason: 'review request already answered or removed',
  },
  {
    name: 'review requested from you',
    when: isRequestForViewer,
    loudness: 'loud',
    reason: 'review requested from you',
  },
  {
    name: 'review requested from someone else',
    when: (input) => input.kind === 'review_requested',
    loudness: 'quiet',
    reason: 'review requested from someone else',
  },
  {
    // An approval stands on any commit; the agent may raise a push that changes what was approved.
    name: 'commits after your approval',
    when: (input) => input.kind === 'commits_after_approval',
    loudness: 'quiet',
    reason: 'new commits after you approved',
  },
  {
    name: 'ready for review, you were asked',
    when: (input) => input.kind === 'ready_for_review' && !isViewersPr(input) && viewerAskedToReview(input.pr, input.viewer),
    loudness: 'loud',
    reason: 'ready for your review',
  },
  {
    name: 'ready for review',
    when: (input) => input.kind === 'ready_for_review',
    loudness: 'quiet',
    reason: 'ready for review',
  },
  {
    // Never loud: the done rule keeps the tile open until the user saw it (DESIGN "Merged without your review").
    name: 'merged without your review',
    when: (input) => input.kind === 'merged_without_review',
    loudness: 'quiet',
    reason: 'merged without your review',
  },
  {
    name: 'comment on your PR',
    when: (input) => input.kind === 'comment' && isViewersPr(input),
    loudness: 'loud',
    reason: 'comment on your PR',
  },
  {
    name: 'other comment',
    when: (input) => input.kind === 'comment',
    loudness: 'quiet',
    reason: 'comment',
  },
  {
    name: 'anything else',
    when: () => true,
    loudness: 'quiet',
    reason: (input) => input.kind.replaceAll('_', ' '),
  },
];

/** The first row that matches, or undefined when the table has a gap. */
export function findLoudnessRow(input: LoudnessInput): LoudnessRow | undefined {
  return LOUDNESS_TABLE.find((row) => row.when(input));
}

/** Rule-based classification, relative to the viewer. The agent may override later, with a reason. */
export function ruleLoudness(input: LoudnessInput): LoudnessDecision {
  const row = findLoudnessRow(input);
  if (!row) {
    throw new Error(`loudness table has no row for ${input.kind}`);
  }
  const reason = typeof row.reason === 'function' ? row.reason(input) : row.reason;
  return { loudness: row.loudness, reason };
}

export function effectiveLoudness(event: PrEvent): Loudness {
  return event.override ? event.override.loudness : event.ruleLoudness;
}

/**
 * The events agent (or the user) made the event loud by an override. The
 * app's own Look closer event is never raised: it is loud by its rule.
 */
export function raisedToLoud(event: PrEvent): boolean {
  return event.override?.loudness === 'loud' && event.kind !== 'look_closer';
}

export function displayState(event: PrEvent): EventDisplayState {
  if (event.seenAt) {
    return 'seen';
  }
  return effectiveLoudness(event);
}

/**
 * A merge without the user's review they have not seen yet. Muted counts as
 * seen: the agent or the user called it noise. Keeps the PR out of done
 * (DESIGN "Merged without your review").
 */
export function isUnseenMergeWithoutReview(event: PrEvent): boolean {
  return event.kind === 'merged_without_review' && event.seenAt === null && effectiveLoudness(event) !== 'muted';
}

export function isUnseenLoud(event: PrEvent): boolean {
  return event.seenAt === null && effectiveLoudness(event) === 'loud';
}
