import { clampDossier, parsePrKey } from '@code-manager/core';
import type { Dossier, DossierFlag, EntityRef, FactCandidate, IsoTime } from '@code-manager/core';
import type { z } from 'zod';
import type { DossierRefs } from './dossier-refs.ts';
import type { dossierUpdateOutput } from './schemas.ts';
import type { DossierUpdateInput, FactClose } from './service.ts';

type DossierAnswer = z.infer<typeof dossierUpdateOutput>;
type EntityAnswer = { kind: EntityRef['kind']; key: string };

function isPrKey(key: string): boolean {
  try {
    parsePrKey(key);
    return true;
  } catch {
    return false;
  }
}

function login(value: string): string {
  return value.trim().replace(/^@/, '');
}

/** Normalises the keys the model wrote; null when a key cannot be what its kind says. */
export function normalizeEntity(entity: EntityAnswer, topicId: string): EntityRef | null {
  const key = entity.key.trim();
  if (entity.kind === 'person') {
    const person = login(key).toLowerCase();
    return person ? { kind: 'person', key: person } : null;
  }
  if (entity.kind === 'pr') {
    return isPrKey(key) ? { kind: 'pr', key } : null;
  }
  if (entity.kind === 'path') {
    return key.includes(':') ? { kind: 'path', key } : null;
  }
  // One initiative per topic: whatever the model called it, it is this topic.
  return { kind: 'initiative', key: topicId };
}

/** A usable date for a change entry: the model's own when it parses, else now. */
function changeTime(at: string, now: IsoTime): IsoTime {
  const time = Date.parse(at);
  return Number.isNaN(time) ? now : new Date(time).toISOString();
}

function toDossier(answer: DossierAnswer['dossier'], memberKeys: Set<string>, refs: DossierRefs, now: IsoTime): Dossier {
  return clampDossier({
    goal: answer.goal,
    summary: answer.summary,
    status: answer.status,
    statusNote: answer.statusNote,
    people: answer.people.map((p) => ({ login: login(p.login), role: p.role, note: p.note })),
    openQuestions: answer.openQuestions.map((q) => ({
      text: q.text,
      askedBy: q.askedBy ? login(q.askedBy) : null,
      refs: refs.resolve(q.refs),
    })),
    // PRs that left or never were members do not belong on the timeline.
    timeline: answer.timeline.filter((entry) => memberKeys.has(entry.prKey)),
    earlier: answer.earlier,
    userCares: answer.userCares,
    recentChanges: answer.recentChanges.map((c) => ({ at: changeTime(c.at, now), text: c.text, refs: refs.resolve(c.refs) })),
  });
}

function toFlags(answer: DossierAnswer['flags'], memberKeys: Set<string>): DossierFlag[] {
  const flags: DossierFlag[] = [];
  for (const flag of answer) {
    const prKey = flag.prKey && memberKeys.has(flag.prKey) ? flag.prKey : null;
    if (flag.kind === 'off_topic_pr' && prKey === null) {
      continue;
    }
    flags.push({ kind: flag.kind, text: flag.text, prKey });
  }
  return flags;
}

/** Provenance is required: a candidate without a single known ref is dropped. validFrom is its earliest ref. */
function toCandidates(answer: DossierAnswer['facts'], topicId: string, refs: DossierRefs): FactCandidate[] {
  const candidates: FactCandidate[] = [];
  for (const fact of answer) {
    const subject = normalizeEntity(fact.subject, topicId);
    const object = fact.object ? normalizeEntity(fact.object, topicId) : null;
    const factRefs = refs.resolve(fact.refs);
    const first = factRefs[0];
    if (!subject || (fact.object && !object) || !first) {
      continue;
    }
    candidates.push({ subject, predicate: fact.predicate, object, text: fact.text, refs: factRefs, validFrom: first.at });
  }
  return candidates;
}

function toCloses(answer: DossierAnswer['closeFacts'], refs: DossierRefs): FactClose[] {
  const closes = new Map<string, FactClose>();
  for (const close of answer) {
    const fact = refs.fact(close.factId);
    if (fact) {
      closes.set(fact.id, { factId: fact.id, reason: close.reason });
    }
  }
  return [...closes.values()];
}

/** Only stale facts can be confirmed, and not ones the same answer closes. */
function toConfirmed(answer: string[], input: DossierUpdateInput, refs: DossierRefs, closed: FactClose[]): string[] {
  const staleIds = new Set(input.staleFacts.map((f) => f.id));
  const closedIds = new Set(closed.map((c) => c.factId));
  const confirmed = new Set<string>();
  for (const shortId of answer) {
    const fact = refs.fact(shortId);
    if (fact && staleIds.has(fact.id) && !closedIds.has(fact.id)) {
      confirmed.add(fact.id);
    }
  }
  return [...confirmed];
}

export interface MappedDossierAnswer {
  dossier: Dossier;
  flags: DossierFlag[];
  facts: FactCandidate[];
  closeFacts: FactClose[];
  confirmedFactIds: string[];
}

/** The parsed answer mapped onto domain types, with every id the prompt did not hand out dropped. */
export function mapDossierAnswer(answer: DossierAnswer, input: DossierUpdateInput, refs: DossierRefs, now: IsoTime): MappedDossierAnswer {
  const memberKeys = new Set(input.prs.map((pr) => pr.key));
  const closeFacts = toCloses(answer.closeFacts, refs);
  return {
    dossier: toDossier(answer.dossier, memberKeys, refs, now),
    flags: toFlags(answer.flags, memberKeys),
    facts: toCandidates(answer.facts, input.topic.id, refs),
    closeFacts,
    confirmedFactIds: toConfirmed(answer.confirmedFactIds, input, refs, closeFacts),
  };
}
