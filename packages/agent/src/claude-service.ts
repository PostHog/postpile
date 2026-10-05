import { clipText, LESSON_TEXT_MAX, mapSetupDraft, mapSetupFit, PING_BODY_MAX, PING_TITLE_MAX, type ReconcileAction, type SetupFitNote } from '@postpile/core';
import type { z } from 'zod';
import { mapConsolidationAnswer } from './consolidation-answer.ts';
import { mapDossierAnswer } from './dossier-answer.ts';
import { DossierRefs } from './dossier-refs.ts';
import { mapGlanceAnswer } from './glance-answer.ts';
import { dossierInputHash, glanceItemInputHash, legacyGlanceItemInputHash } from './hashes.ts';
import { AgentOutputError, parseAgentJson } from './json.ts';
import { modelFor } from './models.ts';
import { chatPrompt } from './prompts/chat.ts';
import { draftCommentPrompt } from './prompts/comment.ts';
import { consolidationPrompt } from './prompts/consolidation.ts';
import { contextSweepPrompt } from './prompts/context-sweep.ts';
import { INSTRUCTIONS_MAX_CHARS, INSTRUCTIONS_SUMMARY_MAX, instructionsChangePrompt } from './prompts/instructions.ts';
import { dossierUpdatePrompt } from './prompts/dossier-update.ts';
import { eventBatchPrompt } from './prompts/event-batch.ts';
import { lessonInstructionsPrompt, lessonWritePrompt } from './prompts/lesson.ts';
import { memoryRecheckPrompt } from './prompts/memory-recheck.ts';
import { pingDecisionPrompt } from './prompts/ping-decision.ts';
import { glanceBatchPrompt } from './prompts/glance-batch.ts';
import { factReconcilePrompt } from './prompts/reconcile.ts';
import { setGroupingPrompt } from './prompts/sets.ts';
import { topicDigestPrompt } from './prompts/topic-digest.ts';
import { topicTidyPrompt } from './prompts/topic-tidy.ts';
import { setupDraftPrompt, setupFitPrompt, setupRefinePrompt } from './prompts/setup.ts';
import { topicAssignmentPrompt } from './prompts/topics.ts';
import { mapReconcileAnswer } from './reconcile-answer.ts';
import { mapSetAnswer } from './set-answer.ts';
import { mapTidyAnswer } from './tidy-answer.ts';
import type { AgentCallObserver, AgentPurpose, AgentRunner } from './runner.ts';
import {
  chatOutput,
  consolidationOutput,
  contextSweepOutput,
  dossierUpdateOutput,
  draftCommentOutput,
  eventBatchOutput,
  factReconcileOutput,
  glanceBatchOutput,
  instructionsChangeOutput,
  lessonWriteOutput,
  memoryRecheckOutput,
  pingDecisionOutput,
  setGroupingOutput,
  setupDraftOutput,
  setupFitOutput,
  setupRefineOutput,
  topicAssignmentOutput,
  topicDigestOutput,
  topicTidyOutput,
} from './schemas.ts';
import type {
  AgentChatReply,
  AgentService,
  ChatInput,
  ConsolidationInput,
  ConsolidationResult,
  ContextSweepInput,
  ContextSweepResult,
  DossierUpdateInput,
  DossierUpdateResult,
  DraftCommentInput,
  EventBatchInput,
  EventOverrideProposal,
  FactReconcileInput,
  GlanceBatchInput,
  GlanceBatchItem,
  GlanceBatchResult,
  InstructionsChangeInput,
  InstructionsChangeReply,
  LessonInstructionsInput,
  LessonWriteAnswer,
  LessonWriteInput,
  MemoryRecheckAnswer,
  MemoryRecheckInput,
  PingDecisionAnswer,
  PingDecisionInput,
  SetGroupingInput,
  SetChanges,
  TopicDigestInput,
  TopicDigestResult,
  TopicTidyInput,
  TopicTidyResult,
  SetupDraftInput,
  SetupDraftResult,
  SetupFitInput,
  SetupRefineInput,
  TopicAssignment,
  TopicAssignmentInput,
} from './service.ts';
import { WORK_THREADS_MAX } from './service.ts';

// Most calls look at a whole topic; drafts and chat answer one question.
const timeouts: Record<AgentPurpose, number> = {
  glance_batch: 240_000,
  topic_assignment: 240_000,
  set_grouping: 240_000,
  dossier_update: 240_000,
  // A dossier and up to 18 glances in one answer: about the two calls it replaces, end to end.
  topic_digest: 420_000,
  fact_reconcile: 180_000,
  // Opus over every active topic, once after an upgrade.
  topic_tidy: 600_000,
  event_classification: 120_000,
  consolidation: 300_000,
  draft_comment: 120_000,
  chat: 120_000,
  instructions_change: 120_000,
  memory_recheck: 120_000,
  // A few reviews per topic; the user may be waiting on a taught one.
  lesson_write: 120_000,
  // A ping that arrives minutes late is worth little; the rules take over after this.
  ping_decision: 60_000,
  // Opus over up to ~60k chars of notes; nobody waits on it.
  context_sweep: 300_000,
  // Opus over about 100 PR lines; the user watches the sweep's progress lines meanwhile.
  setup_draft: 300_000,
  setup_refine: 180_000,
  // Sonnet over the user's own short text, while they look at the Accept step.
  setup_fit: 90_000,
};

/** Bounds for the work context digest, so a runaway answer cannot bloat every prompt. */
const SWEEP_SUMMARY_MAX = 1200;
const SWEEP_TITLE_MAX = 80;
const SWEEP_DETAIL_MAX = 400;
const SWEEP_SOURCES_MAX = 6;

/** Keeps a corrected line about as short as a dossier line or fact. */
const RECHECK_TEXT_MAX = 300;
const RECHECK_WHY_MAX = 600;

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
      // An old or misbehaving model may still say "unsorted": the PR counts as
      // missing, so the engine asks about it again instead of parking it.
      if (assignment.kind === 'unsorted') {
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

  async tidyTopics(input: TopicTidyInput): Promise<TopicTidyResult> {
    if (input.topics.length === 0) {
      return { merges: [], splits: [], renames: [], kinds: [] };
    }
    const { value } = await this.ask('topic_tidy', topicTidyPrompt(input), topicTidyOutput);
    return mapTidyAnswer(value, input);
  }

  async groupSets(input: SetGroupingInput): Promise<SetChanges> {
    const { value } = await this.ask('set_grouping', setGroupingPrompt(input), setGroupingOutput, {
      topicId: input.topic.id,
      attempt: 1,
    });
    return mapSetAnswer(value, input);
  }

  async draftComment(input: DraftCommentInput): Promise<{ body: string }> {
    const { value } = await this.ask('draft_comment', draftCommentPrompt(input), draftCommentOutput);
    return { body: value.body };
  }

  async chat(input: ChatInput): Promise<AgentChatReply> {
    const { value } = await this.ask('chat', chatPrompt(input), chatOutput, { topicId: input.topic.id, attempt: 1 });
    return { reply: value.reply, lasting: value.lasting };
  }

  /**
   * An answer that changes nothing, or grows past INSTRUCTIONS_MAX_CHARS,
   * counts as no change: the user would only see an empty or runaway diff.
   */
  async proposeInstructionsChange(input: InstructionsChangeInput): Promise<InstructionsChangeReply> {
    const { value } = await this.ask('instructions_change', instructionsChangePrompt(input), instructionsChangeOutput);
    const text = value.change?.text.trim() ?? '';
    if (!value.change || text === '' || text === input.instructions.trim()) {
      return { reply: value.reply, change: null };
    }
    if (text.length > INSTRUCTIONS_MAX_CHARS) {
      return { reply: 'The proposed text came back far too long, so it was dropped.', change: null };
    }
    return { reply: value.reply, change: { text: `${text}\n`, summary: clipText(value.change.summary, INSTRUCTIONS_SUMMARY_MAX) } };
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

  /**
   * A broken dossier part fails the whole call (the glances depend on it).
   * Glances are checked one by one like a glance batch; the missing ones go
   * to the topic's glance batches. A broken set part is null: the set job
   * asks again on its own.
   */
  async topicDigest(input: TopicDigestInput): Promise<TopicDigestResult> {
    const refs = new DossierRefs(input.dossier);
    const { value, model } = await this.ask('topic_digest', topicDigestPrompt(input, refs), topicDigestOutput, {
      topicId: input.dossier.topic.id,
      attempt: 1,
    });
    const dossier = { ...mapDossierAnswer(value, input.dossier, refs, this.now()), inputHash: dossierInputHash(input.dossier), model };
    const stamp = { model, createdAt: this.now(), inputHash: (item: GlanceBatchItem) => glanceItemInputHash(input.glances, item) };
    const glances = { ...mapGlanceAnswer({ glances: value.glances }, input.glances, stamp), model };
    // A left-out set part is broken too: treating it as "no changes" would mark the regroup as done.
    const setAnswer = input.sets && value.sets !== undefined ? setGroupingOutput.safeParse(value.sets) : null;
    const sets = input.sets && setAnswer?.success ? mapSetAnswer(setAnswer.data, input.sets) : null;
    return { dossier, glances, sets };
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

  legacyGlanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
    return legacyGlanceItemInputHash(input, item);
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
        const missing = input.items.map((item) => item.pr.key);
        const why = `the whole answer was unusable (${error.message.split(':')[0]})`;
        return { glances: [], missing, missingWhy: Object.fromEntries(missing.map((key) => [key, why])), model };
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

  /**
   * Answers for ids that were not asked, or asked twice, are dropped. A
   * sameAs that names no open line, or a line past LESSON_TEXT_MAX, reads as
   * no lesson rather than a cut-off one.
   */
  async writeLessons(input: LessonWriteInput): Promise<LessonWriteAnswer[]> {
    if (input.items.length === 0) {
      return [];
    }
    const { value } = await this.ask('lesson_write', lessonWritePrompt(input), lessonWriteOutput, {
      topicId: input.topic?.id ?? null,
      attempt: 1,
    });
    const asked = new Set(input.items.map((item) => item.id));
    const open = new Set(input.open.map((lesson) => lesson.id));
    const answers: LessonWriteAnswer[] = [];
    for (const entry of value.lessons) {
      if (!asked.has(entry.id)) {
        continue;
      }
      asked.delete(entry.id);
      const sameAs = entry.sameAs !== null && open.has(entry.sameAs) ? entry.sameAs : null;
      const lessonText = entry.text ?? '';
      const usable = sameAs === null && lessonText !== '' && lessonText.length <= LESSON_TEXT_MAX;
      answers.push({ id: entry.id, text: usable ? lessonText : null, sameAs, why: clipText(entry.why, 300) });
    }
    return answers;
  }

  /** Same bounds as proposeInstructionsChange; whether it only adds is the engine's check. */
  async proposeInstructionsFromLesson(input: LessonInstructionsInput): Promise<InstructionsChangeReply> {
    const { value } = await this.ask('instructions_change', lessonInstructionsPrompt(input), instructionsChangeOutput);
    const text = value.change?.text.trim() ?? '';
    if (!value.change || text === '' || text === input.instructions.trim()) {
      return { reply: value.reply, change: null };
    }
    if (text.length > INSTRUCTIONS_MAX_CHARS) {
      return { reply: 'The proposed text came back far too long, so it was dropped.', change: null };
    }
    return { reply: value.reply, change: { text: `${text}\n`, summary: clipText(value.change.summary, INSTRUCTIONS_SUMMARY_MAX) } };
  }

  /** A fix without a usable new line (empty or the same text) counts as holds. */
  async recheckMemory(input: MemoryRecheckInput): Promise<MemoryRecheckAnswer> {
    const { value } = await this.ask('memory_recheck', memoryRecheckPrompt(input), memoryRecheckOutput, {
      topicId: input.topic?.id ?? null,
      attempt: 1,
    });
    const why = clipText(value.why, RECHECK_WHY_MAX);
    const fixed = clipText(value.text, RECHECK_TEXT_MAX);
    if (value.outcome === 'fix' && fixed !== '' && fixed !== input.claim.trim()) {
      return { outcome: 'fix', text: fixed, why };
    }
    return { outcome: value.outcome === 'drop' ? 'drop' : 'holds', text: input.claim, why };
  }

  /**
   * Answers for ids that were not asked, or asked twice, are dropped. An
   * empty title or body keeps the template text, so a veto-only answer still
   * reads well if it said ping.
   */
  async decidePings(input: PingDecisionInput): Promise<PingDecisionAnswer[]> {
    if (input.items.length === 0) {
      return [];
    }
    const { value } = await this.ask('ping_decision', pingDecisionPrompt(input), pingDecisionOutput);
    const byId = new Map(input.items.map((item) => [item.id, item]));
    const answered = new Set<string>();
    const result: PingDecisionAnswer[] = [];
    for (const decision of value.decisions) {
      const item = byId.get(decision.id);
      if (!item || answered.has(decision.id)) {
        continue;
      }
      answered.add(decision.id);
      result.push({
        id: decision.id,
        ping: decision.ping,
        title: clipText(decision.title || item.template.title, PING_TITLE_MAX),
        body: clipText(decision.body || item.template.body, PING_BODY_MAX),
        reason: clipText(decision.reason || (decision.ping ? 'agent agreed' : 'agent vetoed'), RECHECK_WHY_MAX),
      });
    }
    return result;
  }

  /**
   * Source ids map back to the collected items; unknown ones, unknown topic
   * ids and threads whose title matches a forgotten one are dropped. The
   * digest's lastSeenAt is the collector's, which knows the session times.
   */
  async sweepContext(input: ContextSweepInput): Promise<ContextSweepResult> {
    const { value, model } = await this.ask('context_sweep', contextSweepPrompt(input), contextSweepOutput);
    const items = new Map(input.items.map((item) => [item.id, item]));
    const topicIds = new Set(input.topics.map((topic) => topic.id));
    const forgotten = new Set(input.forgotten.map((thread) => thread.title.trim().toLowerCase()));
    const threads = value.threads
      .filter((thread) => !forgotten.has(thread.title.toLowerCase()))
      .slice(0, WORK_THREADS_MAX)
      .map((thread) => ({
        title: clipText(thread.title, SWEEP_TITLE_MAX),
        detail: clipText(thread.detail, SWEEP_DETAIL_MAX),
        topicIds: [...new Set(thread.topicIds.filter((id) => topicIds.has(id)))],
        sources: [...new Set(thread.sources)]
          .map((id) => items.get(id))
          .filter((item) => item !== undefined)
          .slice(0, SWEEP_SOURCES_MAX)
          .map((item) => ({ kind: item.kind, ref: item.ref })),
      }));
    return {
      digest: { summary: clipText(value.summary, SWEEP_SUMMARY_MAX), threads, lastSeenAt: input.lastSeenAt },
      model,
    };
  }

  async draftSetup(input: SetupDraftInput): Promise<SetupDraftResult> {
    const { value, model } = await this.ask('setup_draft', setupDraftPrompt(input), setupDraftOutput);
    return { draft: mapSetupDraft({ answer: value, sources: input.sources, repos: input.repos, model }), reply: '' };
  }

  /** Claims matching input.userLines come back marked fromUser, so "Why?" says they are the user's own words. */
  async refineSetup(input: SetupRefineInput): Promise<SetupDraftResult> {
    const { value, model } = await this.ask('setup_refine', setupRefinePrompt(input), setupRefineOutput);
    const draft = mapSetupDraft({ answer: value, sources: input.sources, repos: input.repos, model, userLines: new Set(input.userLines) });
    return { draft, reply: clipText(value.reply, RECHECK_WHY_MAX) };
  }

  async checkSetupFit(input: SetupFitInput): Promise<SetupFitNote[]> {
    const { value } = await this.ask('setup_fit', setupFitPrompt(input), setupFitOutput);
    return mapSetupFit(value, input.sections);
  }

  async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    if (input.topics.length === 0 && input.duplicateFacts.length === 0) {
      return { topicProposals: [], areaMerges: [], factMerges: [], ruleIdeas: [], finishedTopics: [] };
    }
    const { value } = await this.ask('consolidation', consolidationPrompt(input), consolidationOutput);
    return mapConsolidationAnswer(value, input);
  }
}
