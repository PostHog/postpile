import type { DossierChange, EventKind, Fact, FactRef, FactRefKind, Pr, PrEvent, PrKey } from '@code-manager/core';
import type { DossierUpdateInput } from './service.ts';

const refKindByEvent: Partial<Record<EventKind, FactRefKind>> = {
  mention: 'comment',
  team_mention: 'comment',
  reply_to_user: 'comment',
  question_to_user: 'comment',
  comment: 'comment',
  bot_comment: 'comment',
  review_approved: 'review',
  review_changes_requested: 'review',
  review_commented: 'review',
  commits_pushed: 'commit',
  commits_after_approval: 'commit',
};

/**
 * The head a claim was made against, so verify can tell when a push outdated
 * it: the commit a review was left on, the commit itself, and otherwise the
 * PR head while the PR is open.
 */
function headAt(kind: FactRefKind, sourceId: string | null, pr: Pr | undefined): string | null {
  if (pr === undefined) {
    return null;
  }
  if (kind === 'review') {
    return pr.reviews.find((review) => review.id === sourceId)?.commitOid ?? null;
  }
  if (kind === 'commit') {
    return sourceId;
  }
  return pr.state === 'OPEN' ? pr.headOid : null;
}

/** Comment, review and commit refs point at their source so verify can spot a deleted one. */
export function eventRef(event: PrEvent, pr: Pr | undefined): FactRef {
  const kind = refKindByEvent[event.kind] ?? 'event';
  const sourceId = kind === 'event' ? event.id : event.sourceId;
  return { kind, prKey: event.prKey, sourceId, url: event.url, at: event.at, headOid: headAt(kind, sourceId, pr) };
}

function prRef(pr: Pr): FactRef {
  return { kind: 'pr', prKey: pr.key, sourceId: null, url: pr.url, at: pr.createdAt, headOid: headAt('pr', null, pr) };
}

function refKey(ref: FactRef): string {
  return `${ref.kind}|${ref.prKey}|${ref.sourceId ?? ''}`;
}

/**
 * The short ids a dossier update prompt hands out, and the way back from
 * them to FactRefs. Models copy "e12" far more reliably than long GitHub ids.
 * - e1..eN: new human events in the delta (bot events are only counted)
 * - F1..Fn: known facts, then stale facts
 * - Q1..Qn / C1..Cn: open questions / recent changes of the previous dossier,
 *   so a carried-over entry keeps its refs
 * - a member PR key: the PR itself
 */
export class DossierRefs {
  private readonly events = new Map<string, PrEvent>();
  private readonly eventShortIds = new Map<string, string>();
  private readonly facts = new Map<string, Fact>();
  private readonly factShortIds = new Map<string, string>();
  private readonly carried = new Map<string, FactRef[]>();
  private readonly changes = new Map<string, DossierChange>();
  private readonly prs = new Map<PrKey, Pr>();

  constructor(input: DossierUpdateInput) {
    for (const event of input.delta.events.filter((e) => !e.isBot)) {
      const shortId = `e${this.events.size + 1}`;
      this.events.set(shortId, event);
      this.eventShortIds.set(event.id, shortId);
    }
    for (const fact of [...input.knownFacts, ...input.staleFacts]) {
      const shortId = `F${this.facts.size + 1}`;
      this.facts.set(shortId, fact);
      this.factShortIds.set(fact.id, shortId);
    }
    const previous = input.previous?.dossier;
    previous?.openQuestions.forEach((question, index) => this.carried.set(`Q${index + 1}`, question.refs));
    previous?.recentChanges.forEach((change, index) => {
      this.carried.set(`C${index + 1}`, change.refs);
      this.changes.set(`C${index + 1}`, change);
    });
    for (const pr of input.prs) {
      this.prs.set(pr.key, pr);
    }
  }

  private refsFor(shortId: string): FactRef[] {
    const event = this.events.get(shortId);
    if (event) {
      return [eventRef(event, this.prs.get(event.prKey))];
    }
    const fact = this.facts.get(shortId);
    if (fact) {
      return fact.refs;
    }
    const carried = this.carried.get(shortId);
    if (carried) {
      return carried;
    }
    const pr = this.prs.get(shortId);
    return pr ? [prRef(pr)] : [];
  }

  eventShortId(event: PrEvent): string | undefined {
    return this.eventShortIds.get(event.id);
  }

  factShortId(fact: Fact): string | undefined {
    return this.factShortIds.get(fact.id);
  }

  /** The stored fact behind a short id, or undefined for an id the prompt never showed. */
  fact(shortId: string): Fact | undefined {
    return this.facts.get(shortId.trim());
  }

  /** The previous dossier's change entry behind a C id, or undefined. */
  change(shortId: string): DossierChange | undefined {
    return this.changes.get(shortId.trim());
  }

  /** Maps short ids to refs, oldest first. Unknown ids are dropped, duplicates merged. */
  resolve(shortIds: string[]): FactRef[] {
    const byKey = new Map<string, FactRef>();
    for (const shortId of shortIds) {
      for (const ref of this.refsFor(shortId.trim())) {
        byKey.set(refKey(ref), ref);
      }
    }
    return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
  }
}
