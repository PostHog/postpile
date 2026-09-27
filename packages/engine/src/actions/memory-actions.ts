import type { ActionResult, FeedbackKind, MemoryCorrection, PendingProposals, RelationOverride } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { UNSORTED_TOPIC_ID } from '../board.ts';
import { relationOverrideKey } from '../memory/placement.ts';
import { failed, ok } from './results.ts';

/** User decisions on engine memory: standing rules, "I have seen this topic" and corrections. */
export class MemoryActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  listProposals(): PendingProposals {
    return { topics: this.store.proposals.listPending(), rules: this.store.ruleProposals.listPending() };
  }

  /** An accepted global rule goes into every prompt from the rule table; a topic rule is appended to the tailoring. */
  decideRuleProposal(proposalId: string, accept: boolean): ActionResult {
    const proposal = this.store.ruleProposals.get(proposalId);
    if (!proposal) {
      return failed(`no rule proposal ${proposalId}`);
    }
    if (proposal.status !== 'pending') {
      return failed(`already ${proposal.status}`);
    }
    const at = this.now().toISOString();
    const topic = proposal.topicId === null ? null : this.store.topics.get(proposal.topicId);
    this.store.transaction(() => {
      if (accept && topic) {
        const tailoring = topic.tailoring.trim() ? `${topic.tailoring.trim()}\n${proposal.text}` : proposal.text;
        this.store.topics.setTailoring(topic.id, tailoring, at);
      }
      this.store.ruleProposals.decide(proposalId, accept ? 'accepted' : 'rejected', at);
    });
    return ok(accept ? 'Accepted' : 'Rejected');
  }

  /** Moves the seen cursor to the newest logged event and the current dossier version. */
  markTopicSeen(topicId: string): ActionResult {
    if (topicId === UNSORTED_TOPIC_ID || !this.store.topics.get(topicId)) {
      return failed(`no topic ${topicId}`);
    }
    this.store.cursors.advance({
      kind: 'seen',
      scope: topicId,
      seq: this.store.eventLog.maxSeq(),
      dossierVersion: this.store.dossiers.latest(topicId)?.version ?? null,
      updatedAt: this.now().toISOString(),
    });
    return ok('Marked seen');
  }

  /**
   * A fact marked wrong is closed now, so it leaves every list and prompt. A
   * dossier line stays until the topic's next dossier update, which gets the
   * logged feedback and must drop or fix it.
   */
  correctMemory(input: MemoryCorrection): ActionResult {
    const at = this.now().toISOString();
    const kind: FeedbackKind = input.kind === 'forget' ? 'memory_forget' : 'memory_wrong';
    if (input.factId === null) {
      if (input.topicId === null || !this.store.topics.get(input.topicId)) {
        return failed(`no topic ${input.topicId ?? ''}`);
      }
      const topicId = input.topicId;
      const relation = input.relation;
      const note = relation ? `${input.text} (it is actually: ${relation})` : input.text;
      this.store.transaction(() => {
        if (relation) {
          const override: RelationOverride = { relation, seq: this.store.eventLog.maxSeq() };
          this.store.meta.set(relationOverrideKey(topicId), JSON.stringify(override));
        }
        this.store.feedback.add({ kind, topicId, tileId: null, prKey: null, setId: null, eventId: null, note, createdAt: at });
      });
      return ok(relation ? 'Moved. It stays there until something new happens in the topic.' : 'Noted. The next sync rewrites the topic memory without it.');
    }
    const fact = this.store.facts.get(input.factId);
    if (!fact) {
      return failed(`no fact ${input.factId}`);
    }
    this.store.transaction(() => {
      this.store.facts.close(fact.id, { invalidAt: at, reason: 'the user said it is wrong', supersededBy: null, expiredAt: at });
      this.store.feedback.add({
        kind,
        topicId: fact.topicId,
        tileId: null,
        prKey: fact.refs[0]?.prKey ?? null,
        setId: null,
        eventId: null,
        note: fact.text,
        createdAt: at,
      });
    });
    return ok('Forgot that fact');
  }
}
