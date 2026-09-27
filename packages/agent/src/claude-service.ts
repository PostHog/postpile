import type { Glance, ReconcileAction } from '@code-manager/core';
import type { z } from 'zod';
import { dossierInputHash, glanceInputHash, glanceItemInputHash, topicSummaryInputHash } from './hashes.ts';
import { parseAgentJson } from './json.ts';
import { modelFor } from './models.ts';
import { chatPrompt } from './prompts/chat.ts';
import { draftCommentPrompt } from './prompts/comment.ts';
import { eventClassificationPrompt } from './prompts/events.ts';
import { glancePrompt } from './prompts/glance.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { topicSummaryPrompt } from './prompts/summary.ts';
import { topicAssignmentPrompt } from './prompts/topics.ts';
import type { AgentCallObserver, AgentPurpose, AgentRunner } from './runner.ts';
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
  ConsolidationInput,
  ConsolidationResult,
  DossierUpdateInput,
  DossierUpdateResult,
  DraftCommentInput,
  EventBatchInput,
  EventClassificationInput,
  EventOverrideProposal,
  FactReconcileInput,
  GlanceBatchInput,
  GlanceBatchItem,
  GlanceBatchResult,
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
  glance_batch: 240_000,
  topic_assignment: 240_000,
  set_grouping: 240_000,
  topic_summary: 180_000,
  dossier_update: 240_000,
  fact_reconcile: 180_000,
  event_classification: 120_000,
  consolidation: 300_000,
  draft_comment: 120_000,
  chat: 120_000,
};

export interface RunnerAgentServiceOptions {
  /** Clock for Glance.createdAt. Tests pass a fixed one. */
  now?: () => string;
  /** Told about every call, including failed ones. */
  observer?: AgentCallObserver;
}

/** Which topic and attempt a call belongs to, for the observer. */
interface CallLabel {
  topicId: string | null;
  attempt: number;
}

const NO_LABEL: CallLabel = { topicId: null, attempt: 1 };

/**
 * AgentService on top of any AgentRunner: build the prompt, run it, parse
 * the JSON with zod, then drop anything that refers to ids the model was not
 * given. Caching is the engine's job; this class never skips a call.
 */
export class RunnerAgentService implements AgentService {
  private readonly now: () => string;
  private readonly observer: AgentCallObserver | null;

  constructor(
    private readonly runner: AgentRunner,
    options: RunnerAgentServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.observer = options.observer ?? null;
  }

  private async ask<T>(
    purpose: AgentPurpose,
    prompt: string,
    schema: z.ZodType<T>,
    label: CallLabel = NO_LABEL,
  ): Promise<{ value: T; model: string }> {
    const model = modelFor(purpose);
    const startedAt = Date.now();
    let response: Awaited<ReturnType<AgentRunner['run']>> | null = null;
    try {
      response = await this.runner.run({ purpose, model, prompt, timeoutMs: timeouts[purpose] });
      const value = parseAgentJson(response.text, schema);
      this.observe(purpose, response.model, true, label, startedAt, response.costUsd);
      return { value, model: response.model };
    } catch (error) {
      this.observe(purpose, response?.model ?? model, false, label, startedAt, response?.costUsd ?? null);
      throw error;
    }
  }

  private observe(
    purpose: AgentPurpose,
    model: string,
    ok: boolean,
    label: CallLabel,
    startedAt: number,
    costUsd: number | null,
  ): void {
    this.observer?.onCall({
      purpose,
      model,
      ok,
      topicId: label.topicId,
      attempt: label.attempt,
      durationMs: Date.now() - startedAt,
      costUsd,
    });
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
      dossierVersion: null,
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

  dossierInputHash(input: DossierUpdateInput): string {
    return dossierInputHash(input);
  }

  async updateDossier(input: DossierUpdateInput): Promise<DossierUpdateResult> {
    throw new Error(`not implemented: updateDossier (${input.topic.id})`);
  }

  async reconcileFacts(input: FactReconcileInput): Promise<ReconcileAction[]> {
    throw new Error(`not implemented: reconcileFacts (${input.items.length} items)`);
  }

  glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
    return glanceItemInputHash(input, item);
  }

  async glanceBatch(input: GlanceBatchInput): Promise<GlanceBatchResult> {
    throw new Error(`not implemented: glanceBatch (${input.items.length} items)`);
  }

  async classifyEventBatch(input: EventBatchInput): Promise<EventOverrideProposal[]> {
    throw new Error(`not implemented: classifyEventBatch (${input.items.length} PRs)`);
  }

  async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    throw new Error(`not implemented: consolidate (${input.topics.length} topics)`);
  }
}
