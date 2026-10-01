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
  PrSetChange,
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
import type { TopicPrState, TopicPrStateCounts } from './topic-pr-state.ts';
import type { OpenedReadCheck } from './quiet-reads.ts';
import type { TileOffers } from './offers.ts';
import type { TileAgentOffers, TopicAgentOffers } from './agent-actions.ts';
import type { TileGroup } from './tile-groups.ts';
import type { Touch } from './last-touch.ts';
import type { ReviewRequest } from './review-request.ts';
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
  /** Unread PRs in the topic (`TileView.unreadPrKeys` summed): the bubble's number, so it adds up to GitHub's unread count. */
  unreadPrs: number;
  /** Their keys, so totals across topics can count a PR once. */
  unreadPrKeys: PrKey[];
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
  /** The most alive PR state among the topic's tracked PRs (`topicPrState`), for the row's icon. Null when it tracks none. */
  prState: TopicPrState | null;
  /** Tracked PRs per state, for the icon's tooltip only. */
  prStateCounts: TopicPrStateCounts;
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
  /** Everyone else on the viewer's home teams; empty until fetched, and without a home team. */
  teamMembers: string[];
  /**
   * The home teams (DESIGN.md "Team roles"). Empty: no home team, so no
   * teammates and no Team filter. Null before roles are decided (every team
   * counts as home).
   */
  homeTeams: string[] | null;
}

export interface PrSummary {
  key: PrKey;
  title: string;
  url: string;
  /** Who opened it, as GitHub says; an agent PR's is the bot. */
  author: string;
  /** Assigned users, for the "assigned to" line when they are not just the author. */
  assignees: string[];
  state: PrState;
  isDraft: boolean;
  provenance: Provenance;
  /** Why the PR is in the tile, as a short code (RV, RT, @, ...). Tooltips and rules; the UI shows `forWhom`. */
  why: WhyCode;
  /** The word chip: "For you", "For team-devex", "Your PR", or none (`forWhom`). */
  forWhom: ForWhom;
  /** The PR queue it falls into (`prTier`); merged and closed PRs are rest. */
  tier: PrTier;
  /** Whether you, a teammate or someone else owns it (`ownerRelation`: wrote it, or a bot opened it and assigned them). */
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
  /** The PR's notification thread is unread on GitHub: its tile is unread, and the PR keeps a mark button even when done. */
  unreadOnGitHub: boolean;
  /**
   * Nothing is asked of the viewer on this PR (`isPrDone`). A tile is done
   * when every tracked member is; the renderer dots the tracked members that
   * are not (DESIGN.md "Actions act on what you look at").
   */
  done: boolean;
  /**
   * A mark-read of this PR waits for the writes lock; null when none does.
   * The detail pane's per-PR Mark read checks this, not the tile's
   * `pendingWrite`, so one PR's pending write does not block its neighbours.
   */
  pendingWrite: TilePendingWrite | null;
  /** The viewer's teams with a pending review request here (`ownTeamRequests`), for "Remove <team>" in the detail pane. */
  ownTeamRequests: string[];
  /** Whose move it is on this PR alone (`prWhoseTurn`), for the detail pane's buttons. */
  turn: WhoseTurn;
  /** Automation, review request, last touch and open ask (`prFacts`). */
  facts: PrFacts;
  /**
   * What a mark-read of this PR alone would leave (`prAfterMarkRead`): the
   * detail pane says "Done for now" only when `done` is true. Always not done
   * for a pulled-in stack layer.
   */
  afterRead: TileAfterRead;
  /**
   * What opening this PR in the detail pane would do (`openedReadCheck`),
   * from the same inputs the server's check reads: mark it read, only handle
   * it, or skip and why. The renderer promises "Marks read when you leave"
   * only when this is not a skip (and writes are on).
   */
  openedRead: OpenedReadCheck;
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

/** The newest ask of the viewer still unanswered on a PR (`unansweredAsk`). */
export type OpenAsk = Pick<PrEvent, 'id' | 'kind' | 'actor' | 'summary' | 'at'>;

/**
 * Facts about one PR, worked out once in core (`prFacts`) so every consumer
 * reads the same answer instead of deciding again (DESIGN.md "Rules layer:
 * one home per fact"). Whose move, done and after-read sit next to them on
 * `PrSummary`.
 */
export interface PrFacts {
  /** Whose PR it is (`prOwners`): the author, or the assignees of a bot's PR. "Ask" names the first. */
  owners: string[];
  /** Every owner is a bot or another automation account (`isBot`): a bot's PR nobody is assigned to. */
  ownerIsAutomation: boolean;
  /** Who a pending review request asks, seen from the viewer (`reviewRequest`); null without one or without a viewer. */
  reviewRequest: ReviewRequest;
  /** The viewer's newest touch (`lastTouch`): review, comment, push, merge or close. */
  lastTouch: Touch | null;
  /** The newest ask of the viewer still unanswered, null when none. */
  openAsk: OpenAsk | null;
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
   * whose move. The tile's button says "Done for now" only when it is done.
   */
  afterRead: TileAfterRead;
  /** A mark-read of one of its PRs waits for the writes lock; null when none does. */
  pendingWrite: TilePendingWrite | null;
  /** What the tile footer and the detail pane offer (`tileOffers`); the renderer only displays it. */
  offers: TileOffers;
  /** The ✨ Approve and the ✨ pill on Mark read, when the agent's verdicts back them (`tileAgentOffers`). */
  agent: TileAgentOffers;
  /** The glance the tile's verdict pill shows (`tileVerdict`): the worst one among its open tracked PRs; null without rows. */
  verdict: TileVerdict | null;
  /** The PRs whose rows get the unread dot (`unreadPrKeys`: what makes the tile unread), in tile order. */
  unreadPrKeys: PrKey[];
  /** Its group in the topic (`tileGroup`): Unread, Open or Dealt with. The renderer groups by it and never works it out itself. */
  group: TileGroup;
  /** The strip's coral NEW pill (`tileNewBadge`): an unread tile whose headline is not automation left quiet. */
  newBadge: boolean;
  /** Every PR of the tile is in a quiet repo; the tile shows a small "quiet repo" note. */
  quietRepo: boolean;
  /**
   * Short repo name ("infra") when every PR of the tile is in another repo
   * than the chosen one (or, under "All repos", the topic's main repo).
   */
  repoLabel: string | null;
}

/** One PR's glance, as its row has it, picked for the tile's verdict pill (`tileVerdict`). */
export interface TileVerdict {
  prKey: PrKey;
  verdict: Verdict | null;
  glanceStale: boolean;
  glanceGap: GlanceGap | null;
  glanceState: GlanceState;
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
  /** The topic's set history, newest first (SET_CHANGES_SHOWN): why each tile holds what it holds. */
  setChanges: PrSetChange[];
  /** Waiting for the user; an outside agent's expired ones are left out (`isLiveProposal`). */
  pendingProposals: TopicProposal[];
  /**
   * Accepted, rejected or expired in the last OUTSIDE_PROPOSAL_DAYS days,
   * newest first, merges into this topic included (an accepted merge
   * archives its source). The MCP topic tool shows them, so an outside agent sees
   * what became of its suggestions and does not repeat itself.
   */
  decidedProposals: TopicProposal[];
  /** Null until the first dossier update for the topic (and always for Unsorted). */
  dossier: DossierView | null;
  /** The header's ✨ Approve and ✨ "Mark N read" (`topicAgentOffers`), from the tiles above. */
  agent: TopicAgentOffers;
}

export interface EventView {
  event: PrEvent;
  display: EventDisplayState;
  /** The event's own seen state is unseen (`eventView`): the detail pane's dot. Muted events count as seen. */
  unseen: boolean;
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
export type SyncPhase = 'fetch' | 'tidy' | 'topics' | 'dossiers' | 'facts' | 'sets' | 'glances' | 'events';

/** In the order a sync starts them. */
export const SYNC_PHASES: SyncPhase[] = ['fetch', 'tidy', 'topics', 'dossiers', 'facts', 'sets', 'glances', 'events'];

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
  /**
   * Set when the action queued a deferred mark-read that offers no undo
   * ("Remove <team>"): the renderer refetches once its window settled, so a
   * mark-read GitHub did not take (or a locked one turning pending) shows.
   */
  settleToken?: string;
}

/** Where an agent-assisted action was clicked: a tile's ✨ Approve or ✨ Mark read, or the topic header's. */
export type AgentActionFrom = 'agent_tile' | 'agent_topic';

/** One PR of an agent Approve: the head the confirm list showed, so a newer push refuses the approve. */
export interface ApprovePrRequest {
  prKey: PrKey;
  headOid: string;
}

export interface PrApproveResult {
  prKey: PrKey;
  ok: boolean;
  /** "Approved", or why not (new commits since you looked, writes off, GitHub's error). */
  message: string;
}

/**
 * An agent Approve over several PRs, each through the single approve. `ok`
 * only when every PR was approved. Never an undo token: approvals are final.
 * `settleToken` is the last approve's follow-up mark-read, so the renderer
 * refetches once it settled.
 */
export interface BatchApproveResult extends ActionResult {
  results: PrApproveResult[];
}

/** Opening a PR in PostPile: whether its GitHub thread was marked read or the PR handled ("opened in PostPile"). Nothing to show either way. */
export interface OpenedReadResult {
  /** Something changed (the thread on GitHub, or the PR's handled state here): the renderer refetches. */
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
  /** wrong_topic with a target: whether the pick came from the picker's suggestions or from a search. Telemetry only. */
  pickedFrom?: 'suggestion' | 'search';
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
