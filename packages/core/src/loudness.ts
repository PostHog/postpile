import { isOwnTeam, sameLogin } from './mentions.ts';
import type { EventDisplayState, EventKind, Loudness, Pr, PrEvent, UserPrState, Viewer } from './types.ts';

export interface LoudnessInput {
  kind: EventKind;
  /** Login of whoever caused the event. */
  actor: string;
  isBot: boolean;
  pr: Pr;
  viewer: Viewer;
  userState: UserPrState | null;
  /** General instructions + topic tailoring, for rules that depend on what the user cares about. */
  caresAboutUnreviewedMerges: boolean;
  /** review_requested / review_request_removed: login or "org/team-slug". */
  subject?: string | null;
  /** The viewer already spoke on the PR after this event, so it is handled. */
  userRepliedAfter?: boolean;
}

export interface LoudnessDecision {
  loudness: Loudness;
  reason: string;
}

// A human talking to the viewer directly.
const addressedKinds: EventKind[] = ['mention', 'team_mention', 'reply_to_user', 'question_to_user'];

const pushKinds: EventKind[] = ['commits_pushed', 'force_pushed'];

// Machine activity that never needs a person: shown with a dot at most.
const machineKinds: EventKind[] = ['ci', 'deploy', 'merge_queue', 'bot_comment'];

const reviewKinds: EventKind[] = ['review_approved', 'review_changes_requested', 'review_commented'];

function decide(loudness: Loudness, reason: string): LoudnessDecision {
  return { loudness, reason };
}

function isViewerSubject(subject: string | null | undefined, viewer: Viewer): boolean {
  if (!subject) {
    return false;
  }
  return sameLogin(subject, viewer.login) || isOwnTeam(subject, viewer.teams);
}

function isViewersPr(input: LoudnessInput): boolean {
  return sameLogin(input.pr.author, input.viewer.login);
}

function machineLoudness(input: LoudnessInput): LoudnessDecision {
  // A bot rebasing or updating a draft is pure churn; nobody reviews drafts.
  if (input.isBot && pushKinds.includes(input.kind) && input.pr.isDraft) {
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
 */
export function ruleLoudness(input: LoudnessInput): LoudnessDecision {
  if (input.actor !== '' && sameLogin(input.actor, input.viewer.login)) {
    return decide('quiet', 'your own activity');
  }
  if (input.isBot || machineKinds.includes(input.kind)) {
    return machineLoudness(input);
  }
  if (addressedKinds.includes(input.kind)) {
    return addressedLoudness(input);
  }
  if (reviewKinds.includes(input.kind)) {
    return reviewLoudness(input);
  }
  switch (input.kind) {
    case 'review_requested':
      if (isViewerSubject(input.subject, input.viewer)) {
        return decide('loud', 'review requested from you');
      }
      return decide('quiet', 'review requested from someone else');
    case 'commits_after_approval':
      return decide('loud', 'new commits after you approved');
    case 'merged_without_review':
      if (input.caresAboutUnreviewedMerges) {
        return decide('loud', 'merged without your review');
      }
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

export function isUnseenLoud(event: PrEvent): boolean {
  return event.seenAt === null && effectiveLoudness(event) === 'loud';
}
