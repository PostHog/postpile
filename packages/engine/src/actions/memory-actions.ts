import { randomBytes } from 'node:crypto';
import {
  appendTailoring,
  fixedClaimNote,
  isLiveProposal,
  parseFixedClaimNote,
  UNDO_WINDOW_MS,
  type ActionResult,
  type Fact,
  type Feedback,
  type FeedbackKind,
  type MemoryCorrection,
  type MemoryCorrectionKind,
  type MemoryRestore,
  type PendingProposals,
  type PrKey,
  type RelationOverride,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { UNSORTED_TOPIC_ID } from '../board.ts';
import { newFactId } from '../ids.ts';
import { relationOverrideKey } from '../memory/placement.ts';
import { failed, ok } from './results.ts';
import { UndoWindow } from './undo-window.ts';

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

/** Feedback kinds that strike a dossier line through until the next update; Restore takes them back. */
const RESTORABLE_KINDS: FeedbackKind[] = ['memory_wrong', 'memory_forget', 'memory_fixed'];

/** Enough recent topic feedback to find every pending correction of a line. */
const FEEDBACK_SCANNED_FOR_RESTORE = 50;

/** The dossier line a correction is about: a fix's note holds the old line first. */
function correctedLine(entry: Feedback): string {
  return entry.kind === 'memory_fixed' ? (parseFixedClaimNote(entry.note)?.text ?? entry.note) : entry.note;
}

/** User decisions on engine memory: standing rules, "I have seen this topic" and corrections. */
export class MemoryActions {
  /** Declined and removed standing rules, for the toast's Undo. */
  readonly ruleUndos: UndoWindow;

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {
    this.ruleUndos = new UndoWindow('rule:', now);
  }

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
        this.store.topics.setTailoring(topic.id, appendTailoring(topic.tailoring, proposal.text), at);
      }
      this.store.ruleProposals.decide(proposalId, accept ? 'accepted' : 'rejected', at);
    });
    if (accept) {
      return ok('Accepted');
    }
    const token = this.ruleUndos.add(() => this.store.ruleProposals.reopen(proposalId));
    return ok('Declined. The agent will not propose this rule again.', token);
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

  /**
   * "Remove" on an accepted rule for every topic (Your instructions ›
   * Accepted rules): it leaves every prompt, reads as rejected so it is not
   * proposed again, and the removal is logged as the user's words. A topic
   * rule lives in the tailoring and is removed there.
   */
  removeStandingRule(ruleId: string): ActionResult {
    const rule = this.store.ruleProposals.get(ruleId);
    if (!rule || rule.status !== 'accepted' || rule.topicId !== null) {
      return failed('That rule is no longer in use.');
    }
    const at = this.now().toISOString();
    const feedbackId = this.store.transaction(() => {
      this.store.ruleProposals.remove(ruleId, at);
      return this.logFeedback('rule_removed', null, null, rule.text, at);
    });
    const token = this.ruleUndos.add(() => {
      this.store.transaction(() => {
        this.store.ruleProposals.restoreAccepted(ruleId, rule.decidedAt);
        this.store.feedback.delete(feedbackId);
      });
    });
    return ok('Removed. The agent stops applying it from the next call on.', token);
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

  /** The current head of every PR the fact's refs point at, as far as the store knows. */
  private currentHeads(fact: Fact): Map<PrKey, string> {
    const prs = this.store.prs.getMany(fact.refs.map((ref) => ref.prKey));
    return new Map([...prs].map(([key, pr]) => [key, pr.headOid]));
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
        // Kept at the PR's current head: pinned to the old one, the read-time check would call it stale again.
        this.store.facts.reanchorRefs(fact.id, this.currentHeads(fact));
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
   * "This no longer holds" on a PR's glance: feedback on the PR, in its
   * topic. The glance's input hash covers that feedback, so the glance turns
   * stale and the next look or catch-up writes it again, with the reason in
   * the prompt. Undoable like any correction.
   */
  private outdateGlance(prKey: PrKey, reason: string, at: string): ActionResult {
    if (!this.store.prs.get(prKey)) {
      return failed(`${prKey} is not in the store`);
    }
    const topicId = this.store.memberships.get(prKey)?.topicId ?? null;
    const feedbackId = this.logFeedback('glance_outdated', topicId, prKey, reason, at);
    const token = this.undoable({ feedbackId, reopenFactId: null, closeFactId: null, restoreCheck: null, override: null });
    return ok('Marked out of date. The agent writes it again on your next look.', token);
  }

  /**
   * Wrong / Forget, or accepting a recheck (confirm, fix). A fact changes now,
   * so it leaves (or rejoins) every list and prompt right away. A dossier line
   * stays until the topic's next dossier update, which gets the logged
   * feedback. Every result carries an undo token.
   */
  correctMemory(input: MemoryCorrection): ActionResult {
    const at = this.now().toISOString();
    if (input.prKey) {
      return this.outdateGlance(input.prKey, input.text, at);
    }
    if (input.factId === null) {
      return this.correctLine(input, at);
    }
    return this.correctFact({ ...input, factId: input.factId }, at);
  }

  /**
   * "Restore" on a struck-through dossier line, for as long as it shows:
   * deletes the line's corrections logged since the latest dossier version,
   * so the next update keeps the line. Once that update has read them, there
   * is nothing left to take back.
   */
  restoreLine(input: MemoryRestore): ActionResult {
    const since = this.store.dossiers.latest(input.topicId)?.createdAt ?? '';
    const pending = this.store.feedback
      .recentForTopic(input.topicId, FEEDBACK_SCANNED_FOR_RESTORE)
      .filter((entry) => entry.createdAt > since && RESTORABLE_KINDS.includes(entry.kind) && correctedLine(entry) === input.text);
    if (pending.length === 0) {
      return failed('Nothing to restore: the topic memory was already rewritten.');
    }
    this.store.transaction(() => {
      for (const entry of pending) {
        this.store.feedback.delete(entry.id);
      }
    });
    return ok('Restored. The next sync keeps that line.');
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
