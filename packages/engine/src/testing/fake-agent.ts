// A scripted AgentService for engine tests. v1-style calls (topic assignment,
// sets, chat, drafts) still go through RunnerAgentService and a FakeRunner;
// the memory v2 calls answer from per-method queues, or with a plain default.
import {
  inputHash,
  RunnerAgentService,
  type AgentCallObserver,
  type AgentPurpose,
  type ConsolidationInput,
  type ConsolidationResult,
  type DossierUpdateInput,
  type DossierUpdateResult,
  type EventBatchInput,
  type EventOverrideProposal,
  type FactReconcileInput,
  type FakeRunner,
  type GlanceBatchInput,
  type GlanceBatchItem,
  type GlanceBatchResult,
} from '@code-manager/agent';
import { emptyDossier, type Glance, type ReconcileAction } from '@code-manager/core';

type Answer<I, O> = (input: I) => O;

export const FAKE_MODEL = 'fake-model';

function defaultDossier(input: DossierUpdateInput): DossierUpdateResult {
  return {
    dossier: { ...emptyDossier(), status: 'active', summary: `${input.topic.name}: ${input.delta.events.length} new events` },
    flags: [],
    facts: [],
    closeFacts: [],
    confirmedFactIds: [],
    inputHash: '',
    model: FAKE_MODEL,
  };
}

function fakeGlance(input: GlanceBatchInput, item: GlanceBatchItem, hash: string): Glance {
  return {
    prKey: item.pr.key,
    verdict: 'LOOKS_SAFE',
    forYou: 'Small change.',
    does: `Does ${item.pr.title}.`,
    risk: 'Low.',
    othersSaid: 'Nothing yet.',
    pullInReason: item.provenance.kind === 'pulled_in' ? item.provenance.reason : null,
    dossierVersion: input.dossier?.version ?? null,
    inputHash: hash,
    model: FAKE_MODEL,
    createdAt: '2026-09-02T12:00:00.000Z',
  };
}

function emptyConsolidation(): ConsolidationResult {
  return { topicProposals: [], factMerges: [], ruleIdeas: [], finishedTopics: [] };
}

export class FakeAgent extends RunnerAgentService {
  readonly dossierInputs: DossierUpdateInput[] = [];
  readonly glanceInputs: GlanceBatchInput[] = [];
  readonly reconcileInputs: FactReconcileInput[] = [];
  readonly eventInputs: EventBatchInput[] = [];
  readonly consolidationInputs: ConsolidationInput[] = [];

  private readonly dossierAnswers: Answer<DossierUpdateInput, DossierUpdateResult>[] = [];
  private readonly glanceAnswers: Answer<GlanceBatchInput, GlanceBatchResult>[] = [];
  private readonly reconcileAnswers: Answer<FactReconcileInput, ReconcileAction[]>[] = [];
  private readonly eventAnswers: Answer<EventBatchInput, EventOverrideProposal[]>[] = [];
  private readonly consolidationAnswers: Answer<ConsolidationInput, ConsolidationResult>[] = [];

  constructor(
    runner: FakeRunner,
    private readonly callObserver: AgentCallObserver,
  ) {
    super(runner, { now: () => '2026-09-02T12:00:00.000Z', observer: callObserver });
  }

  answerDossier(answer: Answer<DossierUpdateInput, Partial<DossierUpdateResult>>): this {
    this.dossierAnswers.push((input) => ({ ...defaultDossier(input), ...answer(input) }));
    return this;
  }

  answerGlances(answer: Answer<GlanceBatchInput, GlanceBatchResult>): this {
    this.glanceAnswers.push(answer);
    return this;
  }

  answerReconcile(answer: Answer<FactReconcileInput, ReconcileAction[]>): this {
    this.reconcileAnswers.push(answer);
    return this;
  }

  answerEvents(answer: Answer<EventBatchInput, EventOverrideProposal[]>): this {
    this.eventAnswers.push(answer);
    return this;
  }

  answerConsolidation(answer: Answer<ConsolidationInput, Partial<ConsolidationResult>>): this {
    this.consolidationAnswers.push((input) => ({ ...emptyConsolidation(), ...answer(input) }));
    return this;
  }

  /** Every glance in the batch, as a well-behaved model would answer. */
  allGlances(input: GlanceBatchInput): GlanceBatchResult {
    const glances = input.items.map((item) => fakeGlance(input, item, this.glanceItemInputHash(input, item)));
    return { glances, missing: [], model: FAKE_MODEL };
  }

  private report(purpose: AgentPurpose, ok: boolean, topicId: string | null, attempt: number): void {
    this.callObserver.onCall({ purpose, model: FAKE_MODEL, ok, topicId, attempt, durationMs: 5, costUsd: 0.01 });
  }

  private answer<I, O>(
    purpose: AgentPurpose,
    queue: Answer<I, O>[],
    input: I,
    fallback: Answer<I, O>,
    label: { topicId: string | null; attempt: number },
  ): O {
    try {
      const result = (queue.shift() ?? fallback)(input);
      this.report(purpose, true, label.topicId, label.attempt);
      return result;
    } catch (error) {
      this.report(purpose, false, label.topicId, label.attempt);
      throw error;
    }
  }

  override dossierInputHash(input: DossierUpdateInput): string {
    return inputHash(
      'dossier',
      input.topic.id,
      input.previous?.version ?? 0,
      input.delta.events.map((e) => e.id),
      input.delta.toSeq,
      input.delta.joinedPrKeys,
      input.delta.leftPrKeys,
      input.delta.staleFactIds,
      input.delta.newFeedback.map((f) => f.id),
      input.context.tailoring,
      input.context.standingRules,
    );
  }

  override glanceItemInputHash(input: GlanceBatchInput, item: GlanceBatchItem): string {
    return inputHash(
      'glance_batch',
      item.pr.key,
      item.pr.headOid,
      item.provenance,
      input.topic?.name ?? null,
      input.dossier?.version ?? null,
      input.context.instructions,
      input.context.tailoring,
      input.context.standingRules,
    );
  }

  override async updateDossier(input: DossierUpdateInput): Promise<DossierUpdateResult> {
    this.dossierInputs.push(input);
    const result = this.answer('dossier_update', this.dossierAnswers, input, defaultDossier, { topicId: input.topic.id, attempt: 1 });
    return { ...result, inputHash: this.dossierInputHash(input) };
  }

  override async reconcileFacts(input: FactReconcileInput): Promise<ReconcileAction[]> {
    this.reconcileInputs.push(input);
    return this.answer('fact_reconcile', this.reconcileAnswers, input, () => [], { topicId: null, attempt: 1 });
  }

  override async glanceBatch(input: GlanceBatchInput): Promise<GlanceBatchResult> {
    this.glanceInputs.push(input);
    const label = { topicId: input.topic?.id ?? null, attempt: input.attempt };
    return this.answer('glance_batch', this.glanceAnswers, input, (i) => this.allGlances(i), label);
  }

  override async classifyEventBatch(input: EventBatchInput): Promise<EventOverrideProposal[]> {
    this.eventInputs.push(input);
    return this.answer('event_classification', this.eventAnswers, input, () => [], { topicId: input.topic?.id ?? null, attempt: 1 });
  }

  override async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    this.consolidationInputs.push(input);
    return this.answer('consolidation', this.consolidationAnswers, input, emptyConsolidation, { topicId: null, attempt: 1 });
  }
}
