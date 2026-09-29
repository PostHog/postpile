import { isAutomation } from './bots.ts';
import { CHANGES_ANSWERED_REASON, isChangesAnswerEvent } from './changes-answered.ts';
import { ADDRESSED_KINDS, PUSH_KINDS } from './kinds.ts';
import { isViewerSubject, sameLogin } from './mentions.ts';
import { viewerAskedToReview } from './review-request.ts';
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
  /** review_requested / review_request_removed: login or "org/team-slug". */
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

function decide(loudness: Loudness, reason: string): LoudnessDecision {
  return { loudness, reason };
}

function isViewersPr(input: LoudnessInput): boolean {
  return sameLogin(input.pr.author, input.viewer.login);
}

function isOpenDraft(input: LoudnessInput): boolean {
  return input.pr.isDraft && input.pr.state === 'OPEN';
}

function machineLoudness(input: LoudnessInput): LoudnessDecision {
  // A bot rebasing or updating a draft is pure churn; nobody reviews drafts.
  if (input.isBot && PUSH_KINDS.includes(input.kind) && input.pr.isDraft) {
    return decide('muted', 'bot pushed to a draft');
  }
  return decide('quiet', 'bot activity');
}

function addressedLoudness(input: LoudnessInput): LoudnessDecision {
  if (input.userRepliedAfter) {
    return decide('quiet', 'you already replied');
  }
  switch (input.kind) {
    case 'mention':
      return decide('loud', 'mentions you');
    case 'team_mention':
      return decide('loud', 'mentions your team');
    case 'reply_to_user':
      return decide('loud', 'replies to you');
    default:
      return decide('loud', 'asks you a question');
  }
}

function reviewLoudness(input: LoudnessInput): LoudnessDecision {
  if (isViewersPr(input)) {
    return decide('loud', 'review on your PR');
  }
  return decide('quiet', 'review by someone else');
}

/**
 * Rule-based classification, relative to the viewer. The agent may override
 * later, with a reason. Order matters: who did it first, then what happened.
 * The bot shortcut is `isAutomation`: it skips review requests aimed at the
 * viewer or their team, whoever clicked them.
 */
export function ruleLoudness(input: LoudnessInput): LoudnessDecision {
  if (input.actor !== '' && sameLogin(input.actor, input.viewer.login)) {
    return decide('quiet', 'your own activity');
  }
  if (isAutomation(input, input.subject ?? null, input.viewer) || machineKinds.includes(input.kind)) {
    return machineLoudness(input);
  }
  if (ADDRESSED_KINDS.includes(input.kind)) {
    return addressedLoudness(input);
  }
  // The author pushed or replied after the viewer asked for changes: that is aimed at the viewer.
  if (input.at !== undefined && isChangesAnswerEvent({ kind: input.kind, actor: input.actor, at: input.at }, input.pr, input.viewer)) {
    return decide('loud', CHANGES_ANSWERED_REASON);
  }
  if (reviewKinds.includes(input.kind)) {
    return reviewLoudness(input);
  }
  switch (input.kind) {
    case 'review_requested':
      // A draft is not up for review yet; marking it ready is what calls for a look.
      if (isViewerSubject(input.subject, input.viewer) && isOpenDraft(input)) {
        return decide('quiet', 'review requested on a draft');
      }
      if (isViewerSubject(input.subject, input.viewer)) {
        if (input.requestAnswered) {
          return decide('quiet', 'review request already answered or removed');
        }
        return decide('loud', 'review requested from you');
      }
      return decide('quiet', 'review requested from someone else');
    case 'commits_after_approval':
      // An approval stands on any commit; the agent may raise a push that changes what was approved.
      return decide('quiet', 'new commits after you approved');
    case 'ready_for_review':
      if (!isViewersPr(input) && viewerAskedToReview(input.pr, input.viewer)) {
        return decide('loud', 'ready for your review');
      }
      return decide('quiet', 'ready for review');
    case 'merged_without_review':
      // Never loud: the done rule keeps the tile open until the user saw it (DESIGN "Merged without your review").
      return decide('quiet', 'merged without your review');
    case 'comment':
      if (isViewersPr(input)) {
        return decide('loud', 'comment on your PR');
      }
      return decide('quiet', 'comment');
    default:
      return decide('quiet', input.kind.replaceAll('_', ' '));
  }
}

export function effectiveLoudness(event: PrEvent): Loudness {
  return event.override ? event.override.loudness : event.ruleLoudness;
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
