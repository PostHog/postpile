import type {
  AmbiguousCandidate,
  ChatMessage,
  Dossier,
  DossierFlag,
  DossierVersion,
  Fact,
  FactCandidate,
  Feedback,
  Glance,
  InstructionsVersion,
  IsoTime,
  Loudness,
  MemoryRecheckOutcome,
  MemorySource,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  PrSetMember,
  Provenance,
  ReconcileAction,
  RelationSignals,
  RuleProposal,
  SetupDraft,
  SetupMaterial,
  SetupRepoCount,
  SetupSectionEdit,
  SetupSource,
  Tile,
  Topic,
  TopicDelta,
  TopicProposal,
  Viewer,
  WhoseTurn,
  WhyCode,
  WorkContextDigest,
  WorkContextSourceKind,
} from '@postpile/core';

/**
 * The memory that goes into every prompt: general instructions from
 * instructions.md, the topic's confirmed tailoring, the newest user
 * corrections for that topic, and accepted standing rules.
 */
export interface PromptContext {
  instructions: string;
  /** The stored version of `instructions`, so a dossier line can cite it. Null when none is stored. */
  instructionsVersion: InstructionsVersion | null;
  tailoring: string;
  recentFeedback: Feedback[];
  /** Accepted global rules from consolidation, oldest first. Part of every input hash. */
  standingRules: string[];
  /**
   * The latest "what you're working on" digest as compact text, '' or absent
   * when there is none. Only some prompts show it (workContextBlock), and it
   * is in no input hash: a new digest must not regenerate every glance and
   * dossier, it applies on their next natural update.
   */
  workContext?: string;
}

export interface TopicChoice {
  id: string;
  name: string;
  summary: string;
  /** dossierBrief() of the topic's latest dossier; '' when it has none yet. */
  brief: string;
  /** PRs in the topic now. Small topics are where fragmentation shows. */
  memberCount: number;
}

export interface TopicAssignmentInput {
  prs: Pr[];
  viewer: Viewer;
  topics: TopicChoice[];
  context: PromptContext;
}

export type TopicAssignment =
  | { prKey: PrKey; kind: 'existing'; topicId: string; reason: string }
  | { prKey: PrKey; kind: 'new'; name: string; reason: string }
  /** No topic fits and a new one is not worth it yet: left in Unsorted until after the next consolidation. */
  | { prKey: PrKey; kind: 'unsorted'; reason: string };

export interface SetGroupingInput {
  topic: Topic;
  prs: Pr[];
  existingSets: PrSet[];
  context: PromptContext;
}

export interface SetProposal {
  title: string;
  take: string;
  members: PrSetMember[];
}

export interface EventOverrideProposal {
  eventId: string;
  loudness: Loudness;
  reason: string;
}

export interface DraftCommentInput {
  pr: Pr;
  viewer: Viewer;
  /** Login of the person being asked. */
  person: string;
  /** What the user wants to ask, in their own words. May be empty. */
  intent: string;
  context: PromptContext;
}

export interface ChatInput {
  topic: Topic;
  tile: Tile;
  prs: Pr[];
  history: ChatMessage[];
  message: string;
  context: PromptContext;
}

/**
 * A lasting point the agent spotted in the user's message. The agent does not
 * say where it applies: the user picks this topic, all topics or just this once.
 */
export interface LastingPoint {
  /** One short instruction, written as the user would say it. */
  text: string;
}

export interface AgentChatReply {
  reply: string;
  /** Set when the message holds a lasting point worth keeping. The engine turns it into a proposal. */
  lasting: LastingPoint | null;
}

/**
 * Only the user's own words and their current instructions. Never GitHub
 * text: anyone can write that, and this call rewrites the text that shapes
 * every other prompt.
 */
export interface InstructionsChangeInput {
  instructions: string;
  message: string;
  /** Their earlier messages in the same chat, oldest first. Context only. */
  earlierMessages: string[];
}

export interface InstructionsChange {
  /** The full new text. */
  text: string;
  summary: string;
}

export interface InstructionsChangeReply {
  reply: string;
  /** Null when the message does not ask for a change across all topics, or the answer was unusable. */
  change: InstructionsChange | null;
}

// ---------------------------------------------------------------------------
// Engine memory v2
// ---------------------------------------------------------------------------

/** Known facts shown to a dossier update, newest first. Keeps the prompt bounded. */
export const FACTS_IN_DOSSIER_PROMPT = 60;
/** Stale facts one dossier update rechecks; the rest wait for the next one. */
export const STALE_FACTS_IN_DOSSIER_PROMPT = 20;
/** The user's newest chat turns in a topic a dossier update sees. */
export const CHAT_TURNS_IN_DOSSIER_PROMPT = 10;

/** REFINE: old dossier + new events + instructions -> new dossier, facts and flags. */
export interface DossierUpdateInput {
  topic: Topic;
  /** Null for the first update of a topic. */
  previous: DossierVersion | null;
  delta: TopicDelta;
  /** Current snapshots of every member PR: state lines for all, short intros for delta.joinedPrKeys. */
  prs: Pr[];
  /** Active, verified facts on the topic's entities, at most FACTS_IN_DOSSIER_PROMPT. */
  knownFacts: Fact[];
  /** Facts that failed verification, at most STALE_FACTS_IN_DOSSIER_PROMPT. The answer confirms, closes or replaces each one. */
  staleFacts: Fact[];
  /** The user's own chat messages in this topic since the previous version, at most CHAT_TURNS_IN_DOSSIER_PROMPT. */
  chatTurns: ChatMessage[];
  /** What the rules could tell about how the topic reaches the user. A decided relation wins over the answer. */
  relationSignals: RelationSignals;
  /** Areas other topics use, to reuse. */
  areas: AreaChoice[];
  /** The topic's area now, null before the first update. */
  currentArea: string | null;
  viewer: Viewer;
  context: PromptContext;
}

export interface AreaChoice {
  name: string;
  topics: number;
}

export interface FactClose {
  factId: string;
  reason: string;
}

export interface DossierUpdateResult {
  /** Already clamped to DOSSIER_LIMITS. */
  dossier: Dossier;
  flags: DossierFlag[];
  /** New or changed claims with refs resolved. The engine reconciles them. Candidates without refs are dropped. */
  facts: FactCandidate[];
  /** knownFacts or staleFacts that are no longer true. Ids that were not in the input are dropped. */
  closeFacts: FactClose[];
  /** staleFacts the update found still true. */
  confirmedFactIds: string[];
  /** The area the answer picked, or null. The engine caps new areas per sync. */
  area: string | null;
  inputHash: string;
  model: string;
}

/** Candidates the deterministic rules could not settle, batched across topics. */
export interface FactReconcileInput {
  items: AmbiguousCandidate[];
  context: PromptContext;
}

export interface GlanceBatchItem {
  pr: Pr;
  provenance: Provenance;
}

/** Up to GLANCE_BATCH_SIZE PRs of one topic, each read against the topic dossier. */
export interface GlanceBatchInput {
  /** Null for Unsorted. */
  topic: Topic | null;
  dossier: DossierVersion | null;
  items: GlanceBatchItem[];
  viewer: Viewer;
  context: PromptContext;
  attempt: 1 | 2;
}

export interface GlanceBatchResult {
  /** One per item the answer covered validly. dossierVersion and inputHash are filled in. */
  glances: Glance[];
  /** Items missing from the answer or failing their own zod check. They go into the retry batch. */
  missing: PrKey[];
  /** Why each missing item is missing ("left out of the answer", "verdict \"SHIP_IT\" ..."), for the error line. */
  missingWhy?: Partial<Record<PrKey, string>>;
  model: string;
}

/** Second opinion on new loud events, one call per topic instead of one per PR. */
export interface EventBatchInput {
  topic: Topic | null;
  items: { pr: Pr; events: PrEvent[] }[];
  viewer: Viewer;
  context: PromptContext;
}

export interface ConsolidationTopic {
  topic: Topic;
  dossier: DossierVersion | null;
  openPrs: number;
  totalPrs: number;
  lastActivityAt: IsoTime | null;
  /** Tiles not done: past about a dozen the topic is too big to scan and may want a split. */
  liveTiles: number;
}

/** The sleep-time job: looks across all topics at once. */
export interface ConsolidationInput {
  topics: ConsolidationTopic[];
  /** Active facts that share a slot (see the consolidator), in groups of 2+. */
  duplicateFacts: Fact[][];
  /** Newest first, all topics. */
  feedback: Feedback[];
  /** So an idea the user already decided on is not proposed again. */
  decidedRules: RuleProposal[];
  decidedTopicProposals: TopicProposal[];
  /** Areas in use across active topics. */
  areas: AreaChoice[];
  context: PromptContext;
}

/** Proposals only; the user applies them. */
export type ConsolidationTopicProposal =
  | { kind: 'rename'; topicId: string; name: string; reason: string }
  | { kind: 'merge'; topicId: string; intoTopicId: string; reason: string }
  | { kind: 'split'; topicId: string; name: string; prKeys: PrKey[]; reason: string };

/** Duplicates to fold into one fact: dropIds get closed with supersededBy keepId. Applied directly. */
export interface FactMerge {
  keepId: string;
  dropIds: string[];
  reason: string;
}

/** A standing rule distilled from repeated feedback. Filed as a pending RuleProposal. */
export interface RuleIdea {
  text: string;
  /** Null for a global rule. */
  topicId: string | null;
  evidenceFeedbackIds: number[];
  reason: string;
}

/** Fold one area into another. Filed as a pending area_merge proposal. */
export interface AreaMerge {
  from: string;
  into: string;
  reason: string;
}

export interface ConsolidationResult {
  topicProposals: ConsolidationTopicProposal[];
  areaMerges: AreaMerge[];
  factMerges: FactMerge[];
  ruleIdeas: RuleIdea[];
  /** The agent's view; the engine retires only topics that also pass the deterministic gate. */
  finishedTopics: { topicId: string; reason: string }[];
}

/** Newest events per PR a memory recheck sees. */
export const EVENTS_PER_PR_IN_RECHECK = 12;
/** PRs a memory recheck sees at most. */
export const PRS_IN_RECHECK = 8;

/** "Recheck" on one fact or dossier line: does it still hold against GitHub? */
export interface MemoryRecheckInput {
  /** The line as the user saw it. */
  claim: string;
  /** "Fact" or "Dossier v3", for the prompt. */
  recordedIn: string;
  /** Null when the line lives outside a topic. */
  topic: Topic | null;
  dossier: DossierVersion | null;
  /** Sources behind the line, as the "Why?" panel shows them. */
  sources: MemorySource[];
  /** The PRs the line is about (its sources), else the topic's newest. At most PRS_IN_RECHECK. */
  prs: Pr[];
  /** Newest events of those PRs, at most EVENTS_PER_PR_IN_RECHECK each. */
  events: PrEvent[];
  viewer: Viewer;
  context: PromptContext;
}

export interface MemoryRecheckAnswer {
  outcome: MemoryRecheckOutcome;
  /** The corrected line for fix, the claim unchanged otherwise. */
  text: string;
  why: string;
}

/** New events per PR a ping decision sees; a burst of CI noise must not crowd out the mention. */
export const EVENTS_PER_PING_ITEM = 8;

/** What the deterministic rules said about one PR's new activity. */
export interface PingRuleView {
  loudness: Loudness;
  reason: string;
  whoseTurn: WhoseTurn;
  why: WhyCode;
}

/**
 * One PR thread with new activity the rules would ping for. The agent may
 * veto the ping or write a better title and body; `template` is what the
 * notification says without it.
 */
export interface PingDecisionItem {
  /** The notification thread id; answers are matched on it. */
  id: string;
  pr: Pr;
  topicName: string | null;
  /** The topic's tailoring, when it has any. The general instructions are in `context`. */
  tailoring: string;
  /** dossierBrief of the topic's latest dossier; '' without one. */
  dossierBrief: string;
  glance: Glance | null;
  /** The new events, newest first, at most EVENTS_PER_PING_ITEM. */
  events: PrEvent[];
  rule: PingRuleView;
  template: { title: string; body: string };
}

/** All new ping-worthy items of one poll cycle, in one call. */
export interface PingDecisionInput {
  items: PingDecisionItem[];
  viewer: Viewer;
  /** General context (no topic): instructions, recent feedback, standing rules. */
  context: PromptContext;
}

export interface PingDecisionAnswer {
  id: string;
  ping: boolean;
  title: string;
  body: string;
  reason: string;
}

/** Threads a context sweep keeps at most. */
export const WORK_THREADS_MAX = 12;

/** One piece of collected local material, with the short id the answer cites. */
export interface ContextSweepItem {
  /** "c1" (CLAUDE.md), "m3" (memory file), "s7" (session). */
  id: string;
  kind: WorkContextSourceKind;
  /** Readable: a file path, or "project · date · title" for a session. */
  ref: string;
  /** Already masked and trimmed to the budget. */
  text: string;
}

export interface ContextSweepTopic {
  id: string;
  name: string;
  /** Dossier brief or topic summary; '' when neither exists yet. */
  about: string;
}

/**
 * The daily "what you're working on" sweep. Everything here is the user's
 * own local material (CLAUDE.md, Claude Code memory files, their first prompts
 * of recent sessions), plus their instructions and the topic list.
 */
export interface ContextSweepInput {
  items: ContextSweepItem[];
  instructions: string;
  topics: ContextSweepTopic[];
  /** Threads the user said Forget on. They must not come back. */
  forgotten: { title: string; detail: string }[];
  /** The last stored digest, so threads stay stable from day to day. */
  previous: WorkContextDigest | null;
  /** Newest session activity in the input; becomes the digest's lastSeenAt. */
  lastSeenAt: IsoTime | null;
  now: IsoTime;
}

export interface ContextSweepResult {
  digest: WorkContextDigest;
  model: string;
}

/**
 * The setup flow's draft of instructions.md. GitHub text in the material is
 * untrusted and fenced; the digest and the current instructions are the
 * user's own. Toolless, like every call that reads GitHub text.
 */
export interface SetupDraftInput {
  material: SetupMaterial;
  /** setupSources(material): the ids the answer may cite. */
  sources: SetupSource[];
  /** rankActivityRepos(material.prs): the only repos a suggestion may name. */
  repos: SetupRepoCount[];
  /** instructions.md as it is now; '' on a first run. */
  current: string;
}

/** "Tell the agent what's off" on the setup draft. */
export interface SetupRefineInput extends SetupDraftInput {
  /** The draft as the user left it (their edits included). */
  draft: SetupSectionEdit[];
  message: string;
  /** Their earlier refine messages, oldest first. */
  earlierMessages: string[];
  /** Lines the user wrote themselves (userWrittenLines, claimKey form); they come back marked fromUser. */
  userLines: string[];
}

export interface SetupDraftResult {
  draft: SetupDraft;
  /** The refine's one-line reply; '' for a first draft. */
  reply: string;
}

/**
 * Every digesting job the agent does. Implementations build the prompt,
 * call the AgentRunner and parse the answer. Caching by input hash is the
 * engine's job: it compares the *InputHash methods with what is stored and
 * skips the call on a hit.
 */
export interface AgentService {
  /** v2: topics carry their dossier brief. */
  assignTopics(input: TopicAssignmentInput): Promise<TopicAssignment[]>;
  groupSets(input: SetGroupingInput): Promise<SetProposal[]>;
  draftComment(input: DraftCommentInput): Promise<{ body: string }>;
  chat(input: ChatInput): Promise<AgentChatReply>;
  /** A proposed new instructions text from one of the user's own messages. Nothing is written here. */
  proposeInstructionsChange(input: InstructionsChangeInput): Promise<InstructionsChangeReply>;

  updateDossier(input: DossierUpdateInput): Promise<DossierUpdateResult>;
  /** At most one action per item; items the answer skipped are left out. */
  reconcileFacts(input: FactReconcileInput): Promise<ReconcileAction[]>;
  /** Per PR, independent of the other PRs in the batch. Covers the dossier version. */
  glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string;
  glanceBatch(input: GlanceBatchInput): Promise<GlanceBatchResult>;
  classifyEventBatch(input: EventBatchInput): Promise<EventOverrideProposal[]>;
  consolidate(input: ConsolidationInput): Promise<ConsolidationResult>;
  /** One line, asked by the user. A fix that changes nothing reads as holds. */
  recheckMemory(input: MemoryRecheckInput): Promise<MemoryRecheckAnswer>;
  /** Ping or not, per item. Items the answer skipped or invented are left out; the engine falls back to rules for them. */
  decidePings(input: PingDecisionInput): Promise<PingDecisionAnswer[]>;
  /** The daily digest of local Claude Code notes. Unknown topic ids and source ids are dropped, forgotten threads too. */
  sweepContext(input: ContextSweepInput): Promise<ContextSweepResult>;
  /** Setup: a first draft of instructions.md. Unknown source ids and repos are dropped. */
  draftSetup(input: SetupDraftInput): Promise<SetupDraftResult>;
  /** Setup: the draft changed as the user asked. Lines the user wrote come back marked fromUser. */
  refineSetup(input: SetupRefineInput): Promise<SetupDraftResult>;
}
