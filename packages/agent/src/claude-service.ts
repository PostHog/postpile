import type { Glance } from '@code-manager/core';
import type { z } from 'zod';
import { glanceInputHash, topicSummaryInputHash } from './hashes.ts';
import { parseAgentJson } from './json.ts';
import { modelFor } from './models.ts';
import { chatPrompt } from './prompts/chat.ts';
import { draftCommentPrompt } from './prompts/comment.ts';
import { eventClassificationPrompt } from './prompts/events.ts';
import { glancePrompt } from './prompts/glance.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { topicSummaryPrompt } from './prompts/summary.ts';
import { topicAssignmentPrompt } from './prompts/topics.ts';
import type { AgentPurpose, AgentRunner } from './runner.ts';
import {
  chatOutput,
  draftCommentOutput,
  eventClassificationOutput,
  glanceOutput,
  setGroupingOutput,
  topicAssignmentOutput,
  topicSummaryOutput,
} from './schemas.ts';
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
  TopicSummaryResult,
} from './service.ts';

// Glances are small and fire per PR; everything else may look at a whole topic.
const timeouts: Record<AgentPurpose, number> = {
  glance: 90_000,
  topic_assignment: 240_000,
  set_grouping: 240_000,
  topic_summary: 180_000,
  event_classification: 120_000,
  draft_comment: 120_000,
  chat: 120_000,
};

export interface RunnerAgentServiceOptions {
  /** Clock for Glance.createdAt. Tests pass a fixed one. */
  now?: () => string;
}

/**
 * AgentService on top of any AgentRunner: build the prompt, run it, parse
 * the JSON with zod, then drop anything that refers to ids the model was not
 * given. Caching is the engine's job; this class never skips a call.
 */
export class RunnerAgentService implements AgentService {
  private readonly now: () => string;

  constructor(
    private readonly runner: AgentRunner,
    options: RunnerAgentServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async ask<T>(purpose: AgentPurpose, prompt: string, schema: z.ZodType<T>): Promise<{ value: T; model: string }> {
    const response = await this.runner.run({
      purpose,
      model: modelFor(purpose),
      prompt,
      timeoutMs: timeouts[purpose],
    });
    return { value: parseAgentJson(response.text, schema), model: response.model };
  }

  glanceInputHash(input: GlanceInput): string {
    return glanceInputHash(input);
  }

  async glance(input: GlanceInput): Promise<Glance> {
    const { value, model } = await this.ask('glance', glancePrompt(input), glanceOutput);
    return {
      prKey: input.pr.key,
      verdict: value.verdict,
      forYou: value.forYou,
      does: value.does,
      risk: value.risk,
      othersSaid: value.othersSaid,
      // The reason is already known from provenance; no need to ask the model to repeat it.
      pullInReason: input.provenance.kind === 'pulled_in' ? input.provenance.reason : null,
      inputHash: glanceInputHash(input),
      model,
      createdAt: this.now(),
    };
  }

  async assignTopics(input: TopicAssignmentInput): Promise<TopicAssignment[]> {
    if (input.prs.length === 0) {
      return [];
    }
    const { value } = await this.ask('topic_assignment', topicAssignmentPrompt(input), topicAssignmentOutput);
    const wanted = new Set(input.prs.map((pr) => pr.key));
    const topicIds = new Set(input.topics.map((t) => t.id));
    const assigned = new Set<string>();
    const result: TopicAssignment[] = [];
    for (const assignment of value.assignments) {
      if (!wanted.has(assignment.prKey) || assigned.has(assignment.prKey)) {
        continue;
      }
      if (assignment.kind === 'existing' && !topicIds.has(assignment.topicId)) {
        continue;
      }
      assigned.add(assignment.prKey);
      result.push(assignment);
    }
    return result;
  }

  async groupSets(input: SetGroupingInput): Promise<SetProposal[]> {
    if (input.prs.length < 2) {
      return [];
    }
    const { value } = await this.ask('set_grouping', setGroupingPrompt(input), setGroupingOutput);
    const known = new Set(input.prs.map((pr) => pr.key));
    const result: SetProposal[] = [];
    for (const set of value.sets) {
      const seen = new Set<string>();
      const members = set.members.filter((m) => {
        const keep = known.has(m.prKey) && !seen.has(m.prKey);
        seen.add(m.prKey);
        return keep;
      });
      if (members.length >= 2) {
        result.push({ title: set.title, take: set.take, members });
      }
    }
    return result;
  }

  async summarizeTopic(input: TopicSummaryInput): Promise<TopicSummaryResult> {
    const { value } = await this.ask('topic_summary', topicSummaryPrompt(input), topicSummaryOutput);
    const currentName = input.topic.name.trim().toLowerCase();
    const mergeTargets = new Set(input.otherTopics.map((t) => t.id).filter((id) => id !== input.topic.id));
    // Drop no-op renames and merges into topics the model made up.
    const proposals = value.proposals.filter((p) =>
      p.kind === 'rename' ? p.name.toLowerCase() !== currentName : mergeTargets.has(p.intoTopicId),
    );
    return { summary: value.summary, inputHash: topicSummaryInputHash(input), proposals };
  }

  async classifyEvents(input: EventClassificationInput): Promise<EventOverrideProposal[]> {
    // A user's own unmute or override always wins; the agent never sees those events.
    const events = input.events.filter((e) => e.override?.by !== 'user');
    if (events.length === 0) {
      return [];
    }
    const { value } = await this.ask(
      'event_classification',
      eventClassificationPrompt({ ...input, events }),
      eventClassificationOutput,
    );
    const byId = new Map(events.map((e) => [e.id, e]));
    return value.overrides.filter((o) => {
      const event = byId.get(o.eventId);
      return event !== undefined && o.loudness !== event.ruleLoudness;
    });
  }

  async draftComment(input: DraftCommentInput): Promise<{ body: string }> {
    const { value } = await this.ask('draft_comment', draftCommentPrompt(input), draftCommentOutput);
    return { body: value.body };
  }

  async chat(input: ChatInput): Promise<AgentChatReply> {
    const { value } = await this.ask('chat', chatPrompt(input), chatOutput);
    const tailoring = value.tailoring?.trim();
    return {
      reply: value.reply,
      tailoringProposal: tailoring ? { topicId: input.topic.id, text: tailoring } : null,
    };
  }
}
