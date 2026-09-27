import type { ReconcileAction } from '@code-manager/core';
import type { z } from 'zod';
import { mapConsolidationAnswer } from './consolidation-answer.ts';
import { mapDossierAnswer } from './dossier-answer.ts';
import { DossierRefs } from './dossier-refs.ts';
import { mapGlanceAnswer } from './glance-answer.ts';
import { dossierInputHash, glanceItemInputHash } from './hashes.ts';
import { AgentOutputError, parseAgentJson } from './json.ts';
import { modelFor } from './models.ts';
import { chatPrompt } from './prompts/chat.ts';
import { draftCommentPrompt } from './prompts/comment.ts';
import { consolidationPrompt } from './prompts/consolidation.ts';
import { dossierUpdatePrompt } from './prompts/dossier-update.ts';
import { eventBatchPrompt } from './prompts/event-batch.ts';
import { glanceBatchPrompt } from './prompts/glance-batch.ts';
import { factReconcilePrompt } from './prompts/reconcile.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { topicAssignmentPrompt } from './prompts/topics.ts';
import { mapReconcileAnswer } from './reconcile-answer.ts';
import type { AgentCallObserver, AgentPurpose, AgentRunner } from './runner.ts';
import {
  chatOutput,
  consolidationOutput,
  dossierUpdateOutput,
  draftCommentOutput,
  eventBatchOutput,
  factReconcileOutput,
  glanceBatchOutput,
  setGroupingOutput,
  topicAssignmentOutput,
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
  EventOverrideProposal,
  FactReconcileInput,
  GlanceBatchInput,
  GlanceBatchItem,
  GlanceBatchResult,
  SetGroupingInput,
  SetProposal,
  TopicAssignment,
  TopicAssignmentInput,
} from './service.ts';

// Most calls look at a whole topic; drafts and chat answer one question.
const timeouts: Record<AgentPurpose, number> = {
  glance_batch: 240_000,
  topic_assignment: 240_000,
  set_grouping: 240_000,
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
    const refs = new DossierRefs(input);
    const { value, model } = await this.ask('dossier_update', dossierUpdatePrompt(input, refs), dossierUpdateOutput, {
      topicId: input.topic.id,
      attempt: 1,
    });
    const mapped = mapDossierAnswer(value, input, refs, this.now());
    return { ...mapped, inputHash: dossierInputHash(input), model };
  }

  async reconcileFacts(input: FactReconcileInput): Promise<ReconcileAction[]> {
    if (input.items.length === 0) {
      return [];
    }
    const { value } = await this.ask('fact_reconcile', factReconcilePrompt(input), factReconcileOutput);
    return mapReconcileAnswer(value, input);
  }

  glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
    return glanceItemInputHash(input, item);
  }

  /**
   * An answer whose outer JSON does not parse counts every PR as missing, so
   * they go into the retry batch like any other gap. Runner failures throw.
   */
  async glanceBatch(input: GlanceBatchInput): Promise<GlanceBatchResult> {
    const model = modelFor('glance_batch');
    if (input.items.length === 0) {
      return { glances: [], missing: [], model };
    }
    const label = { topicId: input.topic?.id ?? null, attempt: input.attempt };
    try {
      const answer = await this.ask('glance_batch', glanceBatchPrompt(input), glanceBatchOutput, label);
      const stamp = { model: answer.model, createdAt: this.now(), inputHash: (item: GlanceBatchItem) => glanceItemInputHash(input, item) };
      return { ...mapGlanceAnswer(answer.value, input, stamp), model: answer.model };
    } catch (error) {
      if (error instanceof AgentOutputError) {
        return { glances: [], missing: input.items.map((item) => item.pr.key), model };
      }
      throw error;
    }
  }

  async classifyEventBatch(input: EventBatchInput): Promise<EventOverrideProposal[]> {
    // A user's own unmute or override always wins; the agent never sees those events.
    const items = input.items
      .map((item) => ({ pr: item.pr, events: item.events.filter((e) => e.override?.by !== 'user') }))
      .filter((item) => item.events.length > 0);
    if (items.length === 0) {
      return [];
    }
    const { value } = await this.ask('event_classification', eventBatchPrompt({ ...input, items }), eventBatchOutput, {
      topicId: input.topic?.id ?? null,
      attempt: 1,
    });
    const byId = new Map(items.flatMap((item) => item.events).map((e) => [e.id, e]));
    const seen = new Set<string>();
    return value.overrides.filter((o) => {
      const event = byId.get(o.eventId);
      const keep = event !== undefined && o.loudness !== event.ruleLoudness && !seen.has(o.eventId);
      seen.add(o.eventId);
      return keep;
    });
  }

  async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    if (input.topics.length === 0 && input.duplicateFacts.length === 0) {
      return { topicProposals: [], factMerges: [], ruleIdeas: [], finishedTopics: [] };
    }
    const { value } = await this.ask('consolidation', consolidationPrompt(input), consolidationOutput);
    return mapConsolidationAnswer(value, input);
  }
}
