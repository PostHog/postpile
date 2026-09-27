// Read models returned by EngineService and sent over the HTTP API.
// The renderer imports these types only, never runtime code from other packages.

import type {
  ChatMessage,
  EventDisplayState,
  Glance,
  IsoTime,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  PrState,
  Provenance,
  TailoringProposal,
  Tile,
  TileState,
  Topic,
  TopicProposal,
  UserPrState,
  Verdict,
} from './types.ts';

export type TopicGroup = 'needs_you' | 'quiet';

export interface TopicListItem {
  topic: Topic;
  /** needs_you when at least one tile is unread. */
  group: TopicGroup;
  unreadTiles: number;
  openTiles: number;
  totalTiles: number;
}

export interface PrSummary {
  key: PrKey;
  title: string;
  url: string;
  author: string;
  state: PrState;
  isDraft: boolean;
  provenance: Provenance;
  verdict: Verdict | null;
  unseenLoudEvents: number;
}

export interface TileView {
  tile: Tile;
  state: TileState;
  prs: PrSummary[];
}

export interface TopicDetail {
  topic: Topic;
  tiles: TileView[];
  sets: PrSet[];
  pendingProposals: TopicProposal[];
}

export interface EventView {
  event: PrEvent;
  display: EventDisplayState;
}

export interface PrDetail {
  pr: Pr;
  events: EventView[];
  glance: Glance | null;
  userState: UserPrState | null;
  topicId: string | null;
  /** Ids of every tile this PR appears in. */
  tileIds: string[];
}

export interface SyncReport {
  startedAt: IsoTime;
  finishedAt: IsoTime;
  /** True when the notifications request came back 304. */
  notificationsNotModified: boolean;
  threads: number;
  prsFetched: number;
  newEvents: number;
  agentCalls: number;
  errors: string[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action queued a deferred GitHub write that can still be undone. */
  undoToken: string | null;
}

export type TileFeedbackKind = 'not_mine' | 'not_related' | 'wrong_topic';

export interface FeedbackInput {
  kind: TileFeedbackKind;
  tileId: string;
  /** The PR the feedback is about. For not_related, the member to drop from the set. */
  prKey: PrKey | null;
  /** wrong_topic: where it should go instead, if the user said. */
  targetTopicId: string | null;
  note: string;
}

export interface ChatReply {
  message: ChatMessage;
  tailoringProposal: TailoringProposal | null;
}
