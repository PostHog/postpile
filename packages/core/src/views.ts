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
import type { ActivityList } from './activity.ts';
import type { TileAfterRead } from './after-read.ts';
import type { GlanceState } from './glance-state.ts';
import type { AgentCallStats, DossierStatus, TopicRelation } from './memory.ts';
import type { DossierView, FactChangeCounts, FactView, MemoryTarget } from './memory-views.ts';
import type { PrStatus } from './pr-status.ts';
import type { PrPrimaryAction } from './primary-action.ts';
import type { PrTier } from './pr-tier.ts';
import type { ViewerApproval } from './review-request.ts';
import type { PersonRelation, TopicPerson, TopicQueues } from './topic-queues.ts';
import type { TopicMove } from './topic-urgency.ts';
import type { TilePerson } from './tile-people.ts';
import type { WhoseTurn } from './whose-turn.ts';
import type { WhatsNew } from './whats-new.ts';
import type { WhyCode } from './why-here.ts';
import type { ForWhom } from './for-whom.ts';

export type TopicGroup = 'needs_you' | 'quiet';

/**
 * Why a PR has no glance yet. call_cap: the sync (or a catch-up run) stopped
 * at its agent-call cap before reaching it. daily_cap: the daily catch-up
 * cap (POSTPILE_CATCHUP_CAP) is spent; the next full sync writes it. failed:
 * the agent was asked (twice) and gave no usable answer.
 */
export interface GlanceGap {
  reason: 'call_cap' | 'daily_cap' | 'failed';
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
  /**
   * The user's move on each live (not done, not snoozed) tile, most urgent
   * first (`topicUrgency`). The row's chip names the first and counts the rest.
   */
  yourMoves: TopicMove[];
  /** Tiles with a merge without the user's review they have not seen (`TileState.unseenMerges`): the grey "merged without you" count. */
  unseenMergeTiles: number;
  /** PRs per tier and open PRs by author, over the PRs in the topic's tiles. */
  queues: TopicQueues;
  /**
   * The row's faces (`topicFaces` over `topicPeople`): PR authors only, you
   * and your teammates first (the team pill), then others by PR count;
   * three at most.
   */
  people: TopicPerson[];
}

/** The sidebar's Finished drawer lists topics retired this recently. */
export const FINISHED_TOPICS_MS = 30 * 24 * 60 * 60 * 1000;

/** A retired topic in the sidebar's Finished drawer. */
export interface FinishedTopic {
  id: string;
  name: string;
  area: string | null;
  /** The topic's last update, which is its retirement unless something touched it since. */
  retiredAt: IsoTime;
  prCount: number;
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
  /** Why the PR is in the tile, as a short code (RV, RT, @, ...). Tooltips and rules; the UI shows `forWhom`. */
  why: WhyCode;
  /** The word chip: "For you", "For team-devex", "Your PR", or none (`forWhom`). */
  forWhom: ForWhom;
  /** The PR queue it falls into (`prTier`); merged and closed PRs are rest. */
  tier: PrTier;
  /** Whether you, a teammate or someone else wrote it. */
  authorRelation: PersonRelation;
  /** The detail pane's primary button (`prPrimaryAction`): never Approve on your own PR. */
  primaryAction: PrPrimaryAction;
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
  /** Where the glance stands (`glanceStateOf`): ready, queued, writing, failed, agent_off, capped or none. */
  glanceState: GlanceState;
  unseenLoudEvents: number;
  /** What changed since the viewer's last touch (`whatsNew`), for the why-now strip; null on a first look or with nothing new. */
  whatsNew: WhatsNew | null;
  updatedAt: IsoTime;
  /** In a quiet repo ("Let it go stale"): tier rest, never urgent, never pings. */
  quietRepo: boolean;
  /**
   * Short repo name ("infra") when this row of a mixed-repo set is from
   * another repo than the chosen one (or the topic's main repo); else null.
   */
  repoLabel: string | null;
}

export interface TileView {
  tile: Tile;
  state: TileState;
  prs: PrSummary[];
  /** The most aimed code among the PRs. */
  why: WhyCode;
  /** The chip and left band of the tile (`tileForWhom`). */
  forWhom: ForWhom;
  /** The most urgent tier among the PRs (`tileTier`); the topic column sorts by it. */
  tier: PrTier;
  /** Author(s), the viewer if they reviewed, other reviewers. At most TILE_PEOPLE_MAX. */
  people: TilePerson[];
  /** Whose move it is on the tile. */
  turn: WhoseTurn;
  /**
   * What a mark-read would leave (`tileAfterMarkRead`): done or not, and
   * whose move. The tile's button says "Mark done" only when it is done.
   */
  afterRead: TileAfterRead;
  /** A mark-read of one of its PRs waits for the writes lock; null when none does. */
  pendingWrite: TilePendingWrite | null;
  /** Every PR of the tile is in a quiet repo; the tile shows a small "quiet repo" note. */
  quietRepo: boolean;
  /**
   * Short repo name ("infra") when every PR of the tile is in another repo
   * than the chosen one (or, under "All repos", the topic's main repo).
   */
  repoLabel: string | null;
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
  /** Waiting for the user; an outside agent's expired ones are left out (`isLiveProposal`). */
  pendingProposals: TopicProposal[];
  /**
   * Accepted, rejected or expired in the last OUTSIDE_PROPOSAL_DAYS days,
   * newest first. The MCP topic tool shows them, so an outside agent sees
   * what became of its suggestions and does not repeat itself.
   */
  decidedProposals: TopicProposal[];
  /** Null until the first dossier update for the topic (and always for Unsorted). */
  dossier: DossierView | null;
}

export interface EventView {
  event: PrEvent;
  display: EventDisplayState;
}

export interface PrDetail {
  pr: Pr;
  /** When the stored snapshot was fetched from GitHub; null when unknown (sample data before a fake fetch). */
  fetchedAt: IsoTime | null;
  /** Every event, unfiltered (search, debug, chat context). */
  events: EventView[];
  /** The detail pane's list (`activityList`): meaningful events, new first, noise folded. */
  activity: ActivityList;
  /** What changed since the viewer's last touch (`whatsNew`): the "New since you looked" box's anchor. */
  whatsNew: WhatsNew | null;
  glance: Glance | null;
  /** True when the glance was made for an older state of the PR or of the instructions. */
  glanceStale: boolean;
  /** Set while there is no glance and the last sync said why. */
  glanceGap: GlanceGap | null;
  /** Where the glance stands (`glanceStateOf`); failed offers Retry. */
  glanceState: GlanceState;
  userState: UserPrState | null;
  /** The viewer's standing approval (`viewerApproval`): app record or GitHub, any commit. Null when none. */
  viewerApproval: ViewerApproval | null;
  /**
   * Agent names ("reviewbot") when only agents approved, also on drafts;
   * empty once a person approved (`agentOnlyApprovers`). The detail says
   * "approved by reviewbot (agent)" with it.
   */
  agentApprovers: string[];
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
  /** Set by the hourly background sync, so telemetry can tell it from a start or "Sync now". */
  auto?: boolean;
}

/**
 * Steps of a sync, for timings and live progress. After topics they overlap
 * (see DESIGN.md › Sync flow › Scheduling), so each timing is the wall time
 * from that step's start to its end, not a slice of the total.
 */
export type SyncPhase = 'fetch' | 'topics' | 'dossiers' | 'facts' | 'sets' | 'glances' | 'events';

/** In the order a sync starts them. */
export const SYNC_PHASES: SyncPhase[] = ['fetch', 'topics', 'dossiers', 'facts', 'sets', 'glances', 'events'];

/** Milliseconds per phase that ran. */
export type SyncPhaseTimings = Partial<Record<SyncPhase, number>>;

/** A sync in flight, for the title bar ("syncing · agent 34/82 · 2m"). */
export interface SyncProgress {
  startedAt: IsoTime;
  /** Phases started and not finished, in sync order. */
  running: SyncPhase[];
  /** Agent calls answered or failed so far. */
  agentCallsDone: number;
  /**
   * Agent calls the sync has taken budget for so far. Grows while it runs:
   * glances are only planned once their topic's dossier landed.
   */
  agentCallsPlanned: number;
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
  /** Finished topics this sync retired. Missing on reports stored before the sync retired topics. */
  topicsRetired?: number;
  /** Missing on reports stored before phase timings existed. */
  phaseMs?: SyncPhaseTimings;
  /**
   * Set when the sync did not run because gh cannot be used (the gh status
   * headline, e.g. "GitHub CLI (gh) not found"). Such a report is not stored.
   */
  blockedBy?: string | null;
  /**
   * Set when the agent was off for this sync (the claude status headline):
   * the fetch and the rules ran, the agent jobs did not. Replaces one error
   * line per skipped call.
   */
  agentOff?: string | null;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action queued a deferred GitHub write that can still be undone. */
  undoToken: string | null;
}

/** Opening a PR in PostPile: whether its GitHub thread was marked read ("opened in PostPile"). Nothing to show either way. */
export interface OpenedReadResult {
  marked: boolean;
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
  /** Set when the user accepts a "Recheck" outcome, so telemetry can count recheck decisions. */
  fromRecheck?: boolean;
}

/** "Recheck" on a fact or dossier line: what the agent should look at. */
export interface MemoryRecheckRequest {
  factId: string | null;
  topicId: string | null;
  /** The line as the user saw it. */
  text: string;
  /** Where the line's sources are; null for lines without a "Why?" target. */
  target: MemoryTarget | null;
  /**
   * Set for "Recheck this assessment": the claim is the PR's glance as a
   * whole, checked against that PR, its events and its topic's dossier.
   */
  prKey?: PrKey | null;
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
   * Agent-call cap for syncs and consolidations when the request names
   * none (launch, "Sync now", /api/consolidate, and the CLI without
   * --max-agent-calls). POSTPILE_MAX_AGENT_CALLS, default 150. Work over the
   * cap waits for the next run.
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
  /**
   * Minutes between background full syncs while the desktop app runs.
   * POSTPILE_AUTO_SYNC_MINUTES, default 60; 0 turns it off.
   */
  autoSyncMinutes: number;
}

/**
 * A lasting point in the user's message comes back for the user to place:
 * this topic, all topics or just this once. The agent does not pick.
 */
export interface ChatReply {
  message: ChatMessage;
  lastingPoint: LastingPointProposal | null;
}
