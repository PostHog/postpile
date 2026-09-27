import type { EventDisplayState, EventKind, Loudness, Pr, PrEvent, UserPrState, Viewer } from './types.ts';

export interface LoudnessInput {
  kind: EventKind;
  isBot: boolean;
  pr: Pr;
  viewer: Viewer;
  userState: UserPrState | null;
  /** General instructions + topic tailoring, for rules that depend on what the user cares about. */
  caresAboutUnreviewedMerges: boolean;
}

export interface LoudnessDecision {
  loudness: Loudness;
  reason: string;
}

/** Rule-based classification. The agent may override later, with a reason. */
export function ruleLoudness(_input: LoudnessInput): LoudnessDecision {
  throw new Error('not implemented');
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
