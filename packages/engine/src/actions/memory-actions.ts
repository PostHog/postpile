import { randomBytes } from 'node:crypto';
import {
  fixedClaimNote,
  isLiveProposal,
  UNDO_WINDOW_MS,
  type ActionResult,
  type Fact,
  type FeedbackKind,
  type MemoryCorrection,
  type MemoryCorrectionKind,
  type PendingProposals,
  type PrKey,
  type RelationOverride,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { UNSORTED_TOPIC_ID } from '../board.ts';
import { newFactId } from '../ids.ts';
import { relationOverrideKey } from '../memory/placement.ts';
import { failed, ok } from './results.ts';

/** Undo tokens of memory corrections; mark-read tokens have no prefix. */
const MEMORY_UNDO_PREFIX = 'memory:';

const FEEDBACK_KINDS: Record<MemoryCorrectionKind, FeedbackKind> = {
  wrong: 'memory_wrong',
  forget: 'memory_forget',
  confirm: 'memory_confirmed',
  fix: 'memory_fixed',
};

const LINE_MESSAGES: Record<MemoryCorrectionKind, string> = {
  wrong: 'Noted. The next sync rewrites the topic memory without it.',
  forget: 'Noted. The next sync rewrites the topic memory without it.',
  confirm: 'Kept. The next sync keeps that line.',
  fix: 'Fixed. The next sync writes the corrected line into the topic memory.',
};

const FACT_MESSAGES: Record<MemoryCorrectionKind, string> = {
  wrong: 'Forgot that fact',
  forget: 'Forgot that fact',
  confirm: 'Kept that fact',
  fix: 'Replaced that fact with the corrected one',
};

/** How to take one correction back. */
interface MemoryUndo {
  until: number;
  feedbackId: number;
  /** The fact the correction closed. */
  reopenFactId: string | null;
  /** The corrected fact a fix added. */
  closeFactId: string | null;
  /** The fact as it was before a confirm. */
  restoreCheck: Fact | null;
  /** The relation override as it was before a relation correction; previous null means none. */
  override: { key: string; previous: string | null } | null;
}

/** User decisions on engine memory: standing rules, "I have seen this topic" and corrections. */
export class MemoryActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  listProposals(): PendingProposals {
    const now = this.now().toISOString();
    return { topics: this.store.proposals.listPending().filter((proposal) => isLiveProposal(proposal, now)), rules: this.store.ruleProposals.listPending() };
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

  private readonly undos = new Map<string, MemoryUndo>();

  /** Feedback row for a correction on a fact or a dossier line. */
  private logFeedback(kind: FeedbackKind, topicId: string | null, prKey: PrKey | null, note: string, at: string): number {
    return this.store.feedback.add({ kind, topicId, tileId: null, prKey, setId: null, eventId: null, note, createdAt: at }).id;
  }

  /** Remembers how to take a correction back, for UNDO_WINDOW_MS. */
  private undoable(undo: Omit<MemoryUndo, 'until'>): string {
    const nowMs = this.now().getTime();
    for (const [token, entry] of this.undos) {
      if (entry.until <= nowMs) {
        this.undos.delete(token);
      }
    }
    const token = `${MEMORY_UNDO_PREFIX}${randomBytes(6).toString('hex')}`;
    this.undos.set(token, { ...undo, until: nowMs + UNDO_WINDOW_MS });
    return token;
  }

  /** A dossier line: logged for the topic's next dossier update, which drops, keeps or rewrites it. */
  private correctLine(input: MemoryCorrection, at: string): ActionResult {
    if (input.topicId === null || !this.store.topics.get(input.topicId)) {
      return failed(`no topic ${input.topicId ?? ''}`);
    }
    const topicId = input.topicId;
    const relation = input.relation;
    const fixed = input.fixedText?.trim() ?? '';
    if (input.kind === 'fix' && fixed === '') {
      return failed('a fix needs the corrected line');
    }
    let note = relation ? `${input.text} (it is actually: ${relation})` : input.text;
    if (input.kind === 'fix') {
      note = fixedClaimNote({ text: input.text, fixed });
    }
    const overrideKey = relationOverrideKey(topicId);
    const previousOverride = this.store.meta.get(overrideKey);
    let feedbackId = 0;
    this.store.transaction(() => {
      if (relation) {
        const override: RelationOverride = { relation, seq: this.store.eventLog.maxSeq() };
        this.store.meta.set(overrideKey, JSON.stringify(override));
      }
      feedbackId = this.logFeedback(FEEDBACK_KINDS[input.kind], topicId, null, note, at);
    });
    const token = this.undoable({
      feedbackId,
      reopenFactId: null,
      closeFactId: null,
      restoreCheck: null,
      override: relation ? { key: overrideKey, previous: previousOverride } : null,
    });
    return ok(relation ? 'Moved. It stays there until something new happens in the topic.' : LINE_MESSAGES[input.kind], token);
  }

  /** A fact: closed (wrong, forget), confirmed, or replaced by the corrected text with the same refs (fix). */
  private correctFact(input: MemoryCorrection & { factId: string }, at: string): ActionResult {
    const fact = this.store.facts.get(input.factId);
    if (!fact) {
      return failed(`no fact ${input.factId}`);
    }
    const fixed = input.fixedText?.trim() ?? '';
    if (input.kind === 'fix' && fixed === '') {
      return failed('a fix needs the corrected line');
    }
    const prKey = fact.refs[0]?.prKey ?? null;
    let feedbackId = 0;
    let replacement: Fact | null = null;
    this.store.transaction(() => {
      if (input.kind === 'confirm') {
        this.store.facts.markVerified([fact.id], at);
        feedbackId = this.logFeedback('memory_confirmed', fact.topicId, prKey, fact.text, at);
        return;
      }
      if (input.kind === 'fix') {
        replacement = { ...fact, id: newFactId(), text: fixed, source: 'agent', validFrom: at, recordedAt: at, staleAt: null, staleReason: null, verifiedAt: at };
        this.store.facts.add(replacement);
        this.store.facts.close(fact.id, { invalidAt: at, reason: 'the user accepted a corrected version', supersededBy: replacement.id, expiredAt: at });
        feedbackId = this.logFeedback('memory_fixed', fact.topicId, prKey, fixedClaimNote({ text: fact.text, fixed }), at);
        return;
      }
      this.store.facts.close(fact.id, { invalidAt: at, reason: 'the user said it is wrong', supersededBy: null, expiredAt: at });
      feedbackId = this.logFeedback(FEEDBACK_KINDS[input.kind], fact.topicId, prKey, fact.text, at);
    });
    const added = replacement as Fact | null;
    const token = this.undoable({
      feedbackId,
      reopenFactId: input.kind === 'confirm' ? null : fact.id,
      closeFactId: added?.id ?? null,
      restoreCheck: input.kind === 'confirm' ? fact : null,
      override: null,
    });
    return ok(FACT_MESSAGES[input.kind], token);
  }

  /**
   * Wrong / Forget, or accepting a recheck (confirm, fix). A fact changes now,
   * so it leaves (or rejoins) every list and prompt right away. A dossier line
   * stays until the topic's next dossier update, which gets the logged
   * feedback. Every result carries an undo token.
   */
  correctMemory(input: MemoryCorrection): ActionResult {
    const at = this.now().toISOString();
    if (input.factId === null) {
      return this.correctLine(input, at);
    }
    return this.correctFact({ ...input, factId: input.factId }, at);
  }

  isMemoryUndo(token: string | null): boolean {
    return token !== null && token.startsWith(MEMORY_UNDO_PREFIX);
  }

  /** Takes a correction back inside its undo window, as if it never happened. */
  undo(token: string): ActionResult {
    const undo = this.undos.get(token);
    this.undos.delete(token);
    if (!undo || undo.until <= this.now().getTime()) {
      return failed('undo window closed');
    }
    this.store.transaction(() => {
      this.store.feedback.delete(undo.feedbackId);
      if (undo.reopenFactId) {
        this.store.facts.reopen(undo.reopenFactId);
      }
      if (undo.closeFactId) {
        const at = this.now().toISOString();
        this.store.facts.close(undo.closeFactId, { invalidAt: at, reason: 'the user undid the fix', supersededBy: null, expiredAt: at });
      }
      if (undo.restoreCheck) {
        this.store.facts.restoreCheck(undo.restoreCheck);
      }
      if (undo.override) {
        if (undo.override.previous === null) {
          this.store.meta.delete(undo.override.key);
        } else {
          this.store.meta.set(undo.override.key, undo.override.previous);
        }
      }
    });
    return ok('Undone');
  }
}
