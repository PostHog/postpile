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
import type { DossierView, FactChangeCounts, FactView, MemoryTarget } from './memory-views.ts';
import type { PrStatus } from './pr-status.ts';
import type { PrTier } from './pr-tier.ts';
import type { PersonRelation, TopicPerson, TopicQueues } from './topic-queues.ts';
import type { TilePerson } from './tile-people.ts';
import type { WhoseTurn } from './whose-turn.ts';
import type { WhyCode } from './why-here.ts';

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
  /** needs_you when an unread tile is still open or it is the user's move (`topicUrgency`). */
  group: TopicGroup;
  unreadTiles: number;
  /** Unread tiles with at least one open PR. Only these make the unread count coral. */
  urgentUnreadTiles: number;
  openTiles: number;
  totalTiles: number;
  /** Live (not done) tiles where the turn is the user's ("Your move"). */
  yourMoveTiles: number;
  /** PRs per tier and open PRs by author, over the PRs in the topic's tiles. */
  queues: TopicQueues;
  /** Authors, reviewers and commenters, no bots; you and your team first. Not capped. */
  people: TopicPerson[];
}

/** Who the app works for, for the sidebar's Mine and Team filter buttons. */
export interface ViewerView {
  /** Null before the first sync stored the viewer. */
  login: string | null;
  /** Everyone else on the viewer's teams; empty until fetched. */
  teamMembers: string[];
}

export interface PrSummary {
  key: PrKey;
  title: string;
  url: string;
  author: string;
  state: PrState;
  isDraft: boolean;
  provenance: Provenance;
  /** Why the PR is in the tile, as a short code (RV, RT, @, ...). */
  why: WhyCode;
  /** The PR queue it falls into (`prTier`); merged and closed PRs are rest. */
  tier: PrTier;
  /** Whether you, a teammate or someone else wrote it. */
  authorRelation: PersonRelation;
  /** Lifecycle, review and checks for the status pill. */
  status: PrStatus;
  /** Unresolved review threads. */
  openThreads: number;
  verdict: Verdict | null;
  /** The PR, instructions or feedback moved since the glance was made; the verdict is old. */
  glanceStale: boolean;
  /** The glance's for_you line, null until a glance exists. */
  forYou: string | null;
  /** Set while there is no glance and the last sync said why. */
  glanceGap: GlanceGap | null;
  unseenLoudEvents: number;
  updatedAt: IsoTime;
  /** In a quiet repo ("Let it go stale"): tier rest, never urgent, never pings. */
  quietRepo: boolean;
}

export interface TileView {
  tile: Tile;
  state: TileState;
  prs: PrSummary[];
  /** The most aimed code among the PRs. */
  why: WhyCode;
  /** The most urgent tier among the PRs (`tileTier`); the topic column sorts by it. */
  tier: PrTier;
  /** Author(s), the viewer if they reviewed, other reviewers. At most TILE_PEOPLE_MAX. */
  people: TilePerson[];
  /** Whose move it is on the tile. */
  turn: WhoseTurn;
  /** A mark-read of one of its PRs waits for the writes lock; null when none does. */
  pendingWrite: TilePendingWrite | null;
  /** Every PR of the tile is in a quiet repo; the tile shows a small "quiet repo" note. */
  quietRepo: boolean;
}

/** "pending: mark read on GitHub" on a tile. */
export interface TilePendingWrite {
  since: IsoTime;
  /** The last send's error, null before any try. */
  error: string | null;
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
  /** PRs found outside the inbox (own open, review requests, recent merges) and fetched because they are new or moved. */
  prsFound: number;
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

/**
 * wrong / forget: the line goes (a fact closes now, a dossier line on the next
 * update). confirm: the user accepted a recheck that found the line still
 * right. fix: the user accepted a recheck's corrected line (`fixedText`).
 */
export type MemoryCorrectionKind = 'wrong' | 'forget' | 'confirm' | 'fix';

/**
 * A decision on a fact or a dossier line: "Forget" on a "what you care
 * about" line, or accepting a "Recheck" outcome. Local memory only, never a
 * GitHub write. The result carries an undo token for UNDO_WINDOW_MS.
 */
export interface MemoryCorrection {
  kind: MemoryCorrectionKind;
  /** A fact is closed, confirmed or replaced right away. Null for a dossier line. */
  factId: string | null;
  /** The topic whose dossier holds the line. For a fact the engine takes the fact's topic. */
  topicId: string | null;
  /** The line as the user saw it. Logged, so the next dossier update drops, keeps or fixes it. */
  text: string;
  /** "Wrong" on a topic's relation, with what it really is. Wins until new evidence arrives. */
  relation?: TopicRelation;
  /** kind fix: the corrected line. */
  fixedText?: string;
}

/** "Recheck" on a fact or dossier line: what the agent should look at. */
export interface MemoryRecheckRequest {
  factId: string | null;
  topicId: string | null;
  /** The line as the user saw it. */
  text: string;
  /** Where the line's sources are; null for lines without a "Why?" target. */
  target: MemoryTarget | null;
}

export type MemoryRecheckOutcome = 'holds' | 'fix' | 'drop';

/** unavailable: the agent could not answer (failed call, daily cap, unknown line). */
export type MemoryRecheckResult =
  | {
      status: 'answered';
      outcome: MemoryRecheckOutcome;
      /** The corrected line when outcome is fix, else the line unchanged. */
      text: string;
      /** One or two sentences with the evidence. */
      why: string;
    }
  | { status: 'unavailable'; reason: 'budget' | 'failed' | 'not_found'; message: string };

/**
 * How the server runs, for the UI. Fixed for the process. Whether GitHub
 * writes are on is not here: it changes at runtime (the footer lock, see
 * GitHubWritesStatus and GET /api/github-writes).
 */
export interface AppConfig {
  fake: boolean;
  /**
   * Agent-call cap for syncs the app starts (on launch and "Sync now") when
   * the request names none. POSTPILE_MAX_AGENT_CALLS, default 30. Work
   * over the cap waits for the next sync. The CLI keeps its own flags.
   */
  syncCallCap: number;
  /**
   * Whether the renderer syncs once when it loads. POSTPILE_SYNC_ON_START=0
   * turns it off, for UI and perf runs against a DB copy that should make no
   * GitHub or agent traffic.
   */
  syncOnStart: boolean;
  /**
   * default: the real database. dev: a separate one (PostPile-dev), for
   * `pnpm desktop` and the repo's scripts (POSTPILE_PROFILE=dev). The
   * title bar shows a DEV badge.
   */
  profile: 'default' | 'dev';
  /** The database this process opened, for the DEV badge's tooltip. Null in fake mode. */
  databasePath: string | null;
}

/**
 * A lasting point in the user's message comes back for the user to place:
 * this topic, all topics or just this once. The agent does not pick.
 */
export interface ChatReply {
  message: ChatMessage;
  lastingPoint: LastingPointProposal | null;
}
