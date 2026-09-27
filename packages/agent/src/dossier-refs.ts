import type {
  ChatMessage,
  DossierChange,
  EventKind,
  Fact,
  FactRef,
  FactRefKind,
  Feedback,
  LineSources,
  Pr,
  PrEvent,
  PrKey,
  UserRef,
} from '@code-manager/core';
import { feedbackLabel } from './prompts/shared.ts';
import type { DossierUpdateInput } from './service.ts';

/** Tailoring lines and corrections a dossier prompt offers as citable sources. */
const USER_SOURCES_PER_KIND = 20;

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

function userRefKey(ref: UserRef): string {
  return `${ref.kind}|${ref.id}|${ref.quote}`;
}

function tailoringLines(tailoring: string): string[] {
  return tailoring
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, USER_SOURCES_PER_KIND);
}

/** Corrections in the context block and the new ones since the previous version, once each. */
function feedbackSources(input: DossierUpdateInput): Feedback[] {
  const byId = new Map<number, Feedback>();
  for (const feedback of [...input.delta.newFeedback, ...input.context.recentFeedback]) {
    byId.set(feedback.id, feedback);
  }
  return [...byId.values()].slice(0, USER_SOURCES_PER_KIND);
}

function chatRef(message: ChatMessage): UserRef {
  return { kind: 'chat', id: String(message.id), at: message.createdAt, quote: message.text };
}

/** One source in the user's own words, with the short id the prompt shows it under. */
export interface UserSource {
  shortId: string;
  ref: UserRef;
}

/**
 * The short ids a dossier update prompt hands out, and the way back from
 * them to FactRefs. Models copy "e12" far more reliably than long GitHub ids.
 * - e1..eN: new human events in the delta (bot events are only counted)
 * - F1..Fn: known facts, then stale facts
 * - Q1..Qn / C1..Cn: open questions / recent changes of the previous dossier,
 *   so a carried-over entry keeps its refs
 * - a member PR key: the PR itself
 * - I1 / T1.. / U1.. / M1..: the user's instructions, topic tailoring lines,
 *   corrections and chat turns, for the sources of a line
 */
export class DossierRefs {
  private readonly events = new Map<string, PrEvent>();
  private readonly eventShortIds = new Map<string, string>();
  private readonly facts = new Map<string, Fact>();
  private readonly factShortIds = new Map<string, string>();
  private readonly carried = new Map<string, FactRef[]>();
  private readonly carriedUser = new Map<string, UserRef[]>();
  private readonly changes = new Map<string, DossierChange>();
  private readonly prs = new Map<PrKey, Pr>();
  private readonly users = new Map<string, UserRef>();

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
    previous?.openQuestions.forEach((question, index) => {
      this.carried.set(`Q${index + 1}`, question.refs);
      this.carriedUser.set(`Q${index + 1}`, question.userRefs ?? []);
    });
    previous?.recentChanges.forEach((change, index) => {
      this.carried.set(`C${index + 1}`, change.refs);
      this.carriedUser.set(`C${index + 1}`, change.userRefs ?? []);
      this.changes.set(`C${index + 1}`, change);
    });
    for (const pr of input.prs) {
      this.prs.set(pr.key, pr);
    }
    this.addUserSources(input);
  }

  private addUserSources(input: DossierUpdateInput): void {
    const { context } = input;
    if (context.instructions.trim()) {
      const version = context.instructionsVersion;
      this.users.set('I1', {
        kind: 'instructions',
        id: version ? String(version.version) : '',
        at: version?.createdAt ?? '',
        quote: version?.summary ?? 'Your general instructions',
      });
    }
    tailoringLines(context.tailoring).forEach((line, index) => {
      this.users.set(`T${index + 1}`, { kind: 'tailoring', id: input.topic.id, at: input.topic.updatedAt, quote: line });
    });
    feedbackSources(input).forEach((feedback, index) => {
      const quote = feedback.note.trim() ? `${feedbackLabel(feedback.kind)}: ${feedback.note.trim()}` : feedbackLabel(feedback.kind);
      this.users.set(`U${index + 1}`, { kind: 'feedback', id: String(feedback.id), at: feedback.createdAt, quote });
    });
    input.chatTurns.forEach((message, index) => this.users.set(`M${index + 1}`, chatRef(message)));
  }

  /** Every source in the user's own words, in the order the prompt lists them. */
  userSources(): UserSource[] {
    return [...this.users].map(([shortId, ref]) => ({ shortId, ref }));
  }

  private userRefsFor(shortId: string): UserRef[] {
    const ref = this.users.get(shortId);
    if (ref) {
      return [ref];
    }
    return this.carriedUser.get(shortId) ?? [];
  }

  /** GitHub refs and the user's own words behind these short ids. Unknown ids are dropped. */
  sources(shortIds: string[]): LineSources {
    const users = new Map<string, UserRef>();
    for (const shortId of shortIds) {
      for (const ref of this.userRefsFor(shortId.trim())) {
        users.set(userRefKey(ref), ref);
      }
    }
    return { refs: this.resolve(shortIds), userRefs: [...users.values()] };
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
