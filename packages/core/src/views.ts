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
  LastingPointProposal,
  Tile,
  TileState,
  Topic,
  TopicProposal,
  UserPrState,
  Verdict,
} from './types.ts';
import type { AgentCallStats, DossierStatus, TopicRelation } from './memory.ts';
import type { DossierView, FactChangeCounts, FactView } from './memory-views.ts';

export type TopicGroup = 'needs_you' | 'quiet';

/**
 * Why a PR has no glance yet. call_cap: the sync stopped at its agent-call
 * cap before reaching it; the next sync picks it up. failed: the agent was
 * asked (twice) and gave no usable answer.
 */
export interface GlanceGap {
  reason: 'call_cap' | 'failed';
  detail: string;
  at: IsoTime;
}

/** The dossier's short state line, for one-line topic subtitles. */
export interface TopicStatusLine {
  status: DossierStatus;
  note: string;
}

/**
 * Where a topic sits for the user: its relation (from the dossier, rules
 * first; a user correction wins until new evidence arrives), who owns it,
 * why it reached them, and its area.
 */
export interface TopicPlacement {
  relation: TopicRelation;
  ownerTeam: string | null;
  whyYou: string;
  area: string | null;
  /** The user corrected the relation and nothing new happened since. */
  corrected: boolean;
}

export interface TopicListItem {
  topic: Topic;
  /** Null until the topic has a dossier with a relation. */
  placement: TopicPlacement | null;
  /** Null until the topic has a dossier. */
  statusLine: TopicStatusLine | null;
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
  /** The PR, instructions or feedback moved since the glance was made; the verdict is old. */
  glanceStale: boolean;
  /** The glance's for_you line, null until a glance exists. */
  forYou: string | null;
  /** Set while there is no glance and the last sync said why. */
  glanceGap: GlanceGap | null;
  unseenLoudEvents: number;
  updatedAt: IsoTime;
}

export interface TileView {
  tile: Tile;
  state: TileState;
  prs: PrSummary[];
}

export interface TopicDetail {
  topic: Topic;
  placement: TopicPlacement | null;
  tiles: TileView[];
  sets: PrSet[];
  pendingProposals: TopicProposal[];
  /** Null until the first dossier update for the topic (and always for Unsorted). */
  dossier: DossierView | null;
}

export interface EventView {
  event: PrEvent;
  display: EventDisplayState;
}

export interface PrDetail {
  pr: Pr;
  events: EventView[];
  glance: Glance | null;
  /** True when the glance was made for an older state of the PR or of the instructions. */
  glanceStale: boolean;
  /** Set while there is no glance and the last sync said why. */
  glanceGap: GlanceGap | null;
  userState: UserPrState | null;
  topicId: string | null;
  /** Ids of every tile this PR appears in. */
  tileIds: string[];
  /** Active facts about this PR or citing it, verified at read time. */
  facts: FactView[];
}

/**
 * Agent jobs a sync can run. 'dossiers' includes reconciling the facts the
 * dossier updates produced.
 */
export type AgentJob = 'topics' | 'dossiers' | 'sets' | 'glances' | 'events';

/** In the order a sync runs them, which is also the order a capped budget is spent in. */
export const ALL_AGENT_JOBS: AgentJob[] = ['topics', 'dossiers', 'sets', 'glances', 'events'];

/** Knobs for cheap runs (smoke tests, first look). Everything is unlimited by default. */
export interface SyncOptions {
  /** Enrich at most this many PRs, newest notification first. The rest follow on later syncs. */
  maxPrs?: number;
  /** Stop making agent calls after this many. 0 means no agent at all. */
  maxAgentCalls?: number;
  /** Only run these agent jobs. Default: all of them. */
  agentJobs?: AgentJob[];
}

export interface SyncReport {
  startedAt: IsoTime;
  finishedAt: IsoTime;
  /** True when the notifications request came back 304. */
  notificationsNotModified: boolean;
  threads: number;
  prsFetched: number;
  /** Unread PR threads still waiting to be enriched because of maxPrs. */
  prsSkipped: number;
  /** Stack layers fetched to complete the stacks of pinged PRs (no agent calls for them). */
  prsPulledIn: number;
  newEvents: number;
  /** Same as agentCallStats.total. */
  agentCalls: number;
  agentCallStats: AgentCallStats;
  dossiersUpdated: number;
  facts: FactChangeCounts;
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

export type MemoryCorrectionKind = 'wrong' | 'forget';

/**
 * "Wrong" on a fact or a dossier line, "Forget" on a "what you care about"
 * line. Local memory only, never a GitHub write.
 */
export interface MemoryCorrection {
  kind: MemoryCorrectionKind;
  /** A fact is closed right away. Null for a dossier line. */
  factId: string | null;
  /** The topic whose dossier holds the line. For a fact the engine takes the fact's topic. */
  topicId: string | null;
  /** The line as the user saw it. Logged, so the next dossier update drops or fixes it. */
  text: string;
  /** "Wrong" on a topic's relation, with what it really is. Wins until new evidence arrives. */
  relation?: TopicRelation;
}

/**
 * How the server runs, for the UI. writesAllowed is false unless the process
 * was started with CODE_MANAGER_ALLOW_WRITES=1 (or runs on sample data, where
 * nothing reaches GitHub); the renderer blocks GitHub-writing actions then.
 */
export interface AppConfig {
  fake: boolean;
  writesAllowed: boolean;
  /**
   * Agent-call cap for syncs the app starts (on launch and "Sync now") when
   * the request names none. CODE_MANAGER_MAX_AGENT_CALLS, default 30. Work
   * over the cap waits for the next sync. The CLI keeps its own flags.
   */
  syncCallCap: number;
}

/**
 * A lasting point in the user's message comes back for the user to place:
 * this topic, all topics or just this once. The agent does not pick.
 */
export interface ChatReply {
  message: ChatMessage;
  lastingPoint: LastingPointProposal | null;
}
