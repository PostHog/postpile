import type {
  ChatMessage,
  Feedback,
  Glance,
  Loudness,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  PrSetMember,
  Provenance,
  TailoringProposal,
  Tile,
  Topic,
  Viewer,
} from '@code-manager/core';

/**
 * The memory that goes into every prompt: general instructions from
 * instructions.md, the topic's confirmed tailoring, and the newest user
 * corrections for that topic.
 */
export interface PromptContext {
  instructions: string;
  tailoring: string;
  recentFeedback: Feedback[];
}

export interface GlanceInput {
  pr: Pr;
  viewer: Viewer;
  provenance: Provenance;
  topic: Topic | null;
  context: PromptContext;
}

export interface TopicChoice {
  id: string;
  name: string;
  summary: string;
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

export interface TopicSummaryInput {
  topic: Topic;
  prs: Pr[];
  context: PromptContext;
}

export interface EventClassificationInput {
  pr: Pr;
  viewer: Viewer;
  events: PrEvent[];
  context: PromptContext;
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

/**
 * Every digesting job the agent does. Implementations build the prompt,
 * call the AgentRunner and parse the answer. Caching by input hash is the
 * engine's job: it calls glanceInputHash first and skips glance() on a hit.
 */
export interface AgentService {
  glanceInputHash(input: GlanceInput): string;
  glance(input: GlanceInput): Promise<Glance>;
  assignTopics(input: TopicAssignmentInput): Promise<TopicAssignment[]>;
  groupSets(input: SetGroupingInput): Promise<SetProposal[]>;
  summarizeTopic(input: TopicSummaryInput): Promise<{ summary: string; inputHash: string }>;
  classifyEvents(input: EventClassificationInput): Promise<EventOverrideProposal[]>;
  draftComment(input: DraftCommentInput): Promise<{ body: string }>;
  chat(input: ChatInput): Promise<AgentChatReply>;
}
