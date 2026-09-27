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
  IsoTime,
  Loudness,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  PrSetMember,
  Provenance,
  ReconcileAction,
  RuleProposal,
  TailoringProposal,
  Tile,
  Topic,
  TopicDelta,
  TopicProposal,
  Viewer,
} from '@code-manager/core';

/**
 * The memory that goes into every prompt: general instructions from
 * instructions.md, the topic's confirmed tailoring, the newest user
 * corrections for that topic, and accepted standing rules.
 */
export interface PromptContext {
  instructions: string;
  tailoring: string;
  recentFeedback: Feedback[];
  /** Accepted global rules from consolidation, oldest first. Part of every input hash. */
  standingRules: string[];
}

export interface TopicChoice {
  id: string;
  name: string;
  summary: string;
  /** dossierBrief() of the topic's latest dossier; '' when it has none yet. */
  brief: string;
}

export interface TopicAssignmentInput {
  prs: Pr[];
  viewer: Viewer;
  topics: TopicChoice[];
  context: PromptContext;
}

export type TopicAssignment =
  | { prKey: PrKey; kind: 'existing'; topicId: string; reason: string }
  | { prKey: PrKey; kind: 'new'; name: string; reason: string };

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

export interface AgentChatReply {
  reply: string;
  /** Set when the message holds a lasting point worth keeping as tailoring. */
  tailoringProposal: TailoringProposal | null;
}

// ---------------------------------------------------------------------------
// Engine memory v2
// ---------------------------------------------------------------------------

/** Known facts shown to a dossier update, newest first. Keeps the prompt bounded. */
export const FACTS_IN_DOSSIER_PROMPT = 60;

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
  /** Facts that failed verification. The answer confirms, closes or replaces each one. */
  staleFacts: Fact[];
  viewer: Viewer;
  context: PromptContext;
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
}

/** The sleep-time job: looks across all topics at once. */
export interface ConsolidationInput {
  topics: ConsolidationTopic[];
  /** Active facts grouped by subject + predicate where a group has 2+ facts. */
  duplicateFacts: Fact[][];
  /** Newest first, all topics. */
  feedback: Feedback[];
  /** So an idea the user already decided on is not proposed again. */
  decidedRules: RuleProposal[];
  decidedTopicProposals: TopicProposal[];
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

export interface ConsolidationResult {
  topicProposals: ConsolidationTopicProposal[];
  factMerges: FactMerge[];
  ruleIdeas: RuleIdea[];
  /** The agent's view; the engine retires only topics that also pass the deterministic gate. */
  finishedTopics: { topicId: string; reason: string }[];
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

  /** Same input, same hash: the engine skips updateDossier when it matches the latest version's. */
  dossierInputHash(input: DossierUpdateInput): string;
  updateDossier(input: DossierUpdateInput): Promise<DossierUpdateResult>;
  /** At most one action per item; items the answer skipped are left out. */
  reconcileFacts(input: FactReconcileInput): Promise<ReconcileAction[]>;
  /** Per PR, independent of the other PRs in the batch. Covers the dossier version. */
  glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string;
  glanceBatch(input: GlanceBatchInput): Promise<GlanceBatchResult>;
  classifyEventBatch(input: EventBatchInput): Promise<EventOverrideProposal[]>;
  consolidate(input: ConsolidationInput): Promise<ConsolidationResult>;
}
