import type { Glance } from '@code-manager/core';
import type { AgentRunner } from './runner.ts';
import type {
  AgentChatReply,
  AgentService,
  ChatInput,
  DraftCommentInput,
  EventClassificationInput,
  EventOverrideProposal,
  GlanceInput,
  SetGroupingInput,
  SetProposal,
  TopicAssignment,
  TopicAssignmentInput,
  TopicSummaryInput,
} from './service.ts';

/** AgentService on top of any AgentRunner. Prompt builders live in prompts/. */
export class RunnerAgentService implements AgentService {
  constructor(private readonly runner: AgentRunner) {}

  glanceInputHash(_input: GlanceInput): string {
    throw new Error('not implemented');
  }

  glance(_input: GlanceInput): Promise<Glance> {
    throw new Error('not implemented');
  }

  assignTopics(_input: TopicAssignmentInput): Promise<TopicAssignment[]> {
    throw new Error('not implemented');
  }

  groupSets(_input: SetGroupingInput): Promise<SetProposal[]> {
    throw new Error('not implemented');
  }

  summarizeTopic(_input: TopicSummaryInput): Promise<{ summary: string; inputHash: string }> {
    throw new Error('not implemented');
  }

  classifyEvents(_input: EventClassificationInput): Promise<EventOverrideProposal[]> {
    throw new Error('not implemented');
  }

  draftComment(_input: DraftCommentInput): Promise<{ body: string }> {
    throw new Error('not implemented');
  }

  chat(_input: ChatInput): Promise<AgentChatReply> {
    throw new Error('not implemented');
  }
}
