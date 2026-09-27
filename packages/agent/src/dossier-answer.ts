import { clampDossier, parsePrKey } from '@code-manager/core';
import type {
  Dossier,
  DossierCare,
  DossierCareSource,
  DossierFlag,
  DossierPrEntry,
  DossierQuestion,
  DossierRelation,
  EntityRef,
  FactCandidate,
  IsoTime,
  LineSources,
} from '@code-manager/core';
import type { z } from 'zod';
import type { DossierRefs } from './dossier-refs.ts';
import type { dossierUpdateOutput } from './schemas.ts';
import type { DossierUpdateInput, FactClose } from './service.ts';

type DossierAnswer = z.infer<typeof dossierUpdateOutput>;
type EntityAnswer = { kind: EntityRef['kind']; key: string };
type ChangeAnswer = DossierAnswer['dossier']['recentChanges'][number];

/** "First write-up." and the like, which a real sync put at the start of user-facing fields. */
const META_LEAD = /^(first|initial) (write-?up|version|dossier)[^.]*\.\s*/i;

function withoutMetaLead(text: string): string {
  return text.replace(META_LEAD, '');
}

function hasSources(sources: LineSources): boolean {
  return sources.refs.length > 0 || sources.userRefs.length > 0;
}

function sourcesOf(line: { refs?: LineSources['refs']; userRefs?: LineSources['userRefs'] } | undefined): LineSources | undefined {
  return line ? { refs: line.refs ?? [], userRefs: line.userRefs ?? [] } : undefined;
}

/**
 * What a line rests on: the ids the answer cited, or, when it cited none
 * and the line did not change, the sources it had in the previous version.
 * Ids the prompt never handed out are dropped by DossierRefs.
 */
function lineSources(cited: string[], refs: DossierRefs, unchanged: LineSources | undefined): LineSources {
  const sources = refs.sources(cited);
  if (!hasSources(sources) && unchanged) {
    return unchanged;
  }
  return sources;
}

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

/**
 * When a change entry arrived, which is what "since you last looked" compares.
 * An entry carried over from the previous version (same text, or citing its C
 * id) keeps its time; anything else is new now. The model only ever sees
 * dates, so its own `at` would hide same-day changes, and a future date would
 * look new forever.
 */
function changeTime(change: ChangeAnswer, input: DossierUpdateInput, refs: DossierRefs, now: IsoTime): IsoTime {
  const sameText = input.previous?.dossier.recentChanges.find((old) => old.text.trim() === change.text);
  const cited = change.refs.map((shortId) => refs.change(shortId)).find((old) => old !== undefined);
  return (sameText ?? cited)?.at ?? now;
}

/** The sources the prompt actually carried. A care citing any other source was made up, or planted in GitHub text. */
function careSources(input: DossierUpdateInput): Set<DossierCareSource> {
  const sources = new Set<DossierCareSource>(['observed']);
  if (input.context.instructions.trim()) {
    sources.add('instructions');
  }
  if (input.context.tailoring.trim()) {
    sources.add('tailoring');
  }
  if (input.context.recentFeedback.length > 0 || input.delta.newFeedback.length > 0) {
    sources.add('feedback');
  }
  return sources;
}

function toCares(answer: DossierAnswer['dossier']['userCares'], input: DossierUpdateInput, refs: DossierRefs): DossierCare[] {
  const allowed = careSources(input);
  const previous = input.previous?.dossier.userCares ?? [];
  return answer
    .filter((care) => allowed.has(care.source))
    .map((care) => {
      const sources = lineSources(care.refs, refs, sourcesOf(previous.find((old) => old.text === care.text)));
      return { text: care.text, source: care.source, ...sources };
    });
}

function toQuestions(answer: DossierAnswer['dossier']['openQuestions'], input: DossierUpdateInput, refs: DossierRefs): DossierQuestion[] {
  const previous = input.previous?.dossier.openQuestions ?? [];
  return answer.map((q) => {
    const sources = lineSources(q.refs, refs, sourcesOf(previous.find((old) => old.text === q.text)));
    return { text: q.text, askedBy: q.askedBy ? login(q.askedBy) : null, ...sources };
  });
}

/** PRs that left or never were members do not belong on the timeline. */
function toTimeline(answer: DossierAnswer['dossier']['timeline'], input: DossierUpdateInput, refs: DossierRefs): DossierPrEntry[] {
  const memberKeys = new Set(input.prs.map((pr) => pr.key));
  const previous = input.previous?.dossier.timeline ?? [];
  return answer
    .filter((entry) => memberKeys.has(entry.prKey))
    .map((entry) => {
      const old = previous.find((candidate) => candidate.prKey === entry.prKey && candidate.role === entry.role);
      return { prKey: entry.prKey, role: entry.role, ...lineSources(entry.refs, refs, sourcesOf(old)) };
    });
}

/**
 * Rules first: a relation the rules decided (the user drives it, only
 * passive threads) wins over the answer, and so does their whyYou. The
 * answer decides the ambiguous ones; without either, the previous relation
 * stays, else fyi.
 */
function toRelation(answer: DossierAnswer['dossier']['relation'], input: DossierUpdateInput, refs: DossierRefs): DossierRelation {
  const signals = input.relationSignals;
  const previous = input.previous?.dossier.relation;
  const kind = signals.relation ?? answer?.kind ?? previous?.kind ?? 'fyi';
  const whyYou = signals.relation ? signals.whyYou : answer?.whyYou || signals.whyYou;
  const unchanged = previous && previous.kind === kind && previous.whyYou === whyYou ? sourcesOf(previous) : undefined;
  return { kind, ownerTeam: answer?.ownerTeam ?? signals.ownerTeam, whyYou, ...lineSources(answer?.refs ?? [], refs, unchanged) };
}

function toDossier(answer: DossierAnswer['dossier'], input: DossierUpdateInput, refs: DossierRefs, now: IsoTime): Dossier {
  const previous = input.previous?.dossier;
  const sameGoal = previous !== undefined && previous.goal === answer.goal;
  const sameStatus = previous !== undefined && previous.status === answer.status && previous.statusNote === answer.statusNote;
  return clampDossier({
    goal: answer.goal,
    goalSources: lineSources(answer.goalRefs, refs, sameGoal ? previous.goalSources : undefined),
    summary: withoutMetaLead(answer.summary) || answer.summary,
    status: answer.status,
    statusNote: withoutMetaLead(answer.statusNote),
    statusSources: lineSources(answer.statusRefs, refs, sameStatus ? previous.statusSources : undefined),
    people: answer.people.map((p) => ({ login: login(p.login), role: p.role, note: p.note })),
    openQuestions: toQuestions(answer.openQuestions, input, refs),
    timeline: toTimeline(answer.timeline, input, refs),
    earlier: answer.earlier,
    userCares: toCares(answer.userCares, input, refs),
    recentChanges: answer.recentChanges.map((c) => {
      const old = previous?.recentChanges.find((candidate) => candidate.text === c.text);
      return { at: changeTime(c, input, refs, now), text: c.text, ...lineSources(c.refs, refs, sourcesOf(old)) };
    }),
    relation: toRelation(answer.relation, input, refs),
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
    // Its refs can only be events or PRs, never the user's own words, so GitHub text would be its only source.
    if (fact.predicate === 'user_cares') {
      continue;
    }
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

/** An area name as the sidebar shows it: trimmed, short, null when empty. */
function toArea(area: string | null): string | null {
  const name = area?.trim().replace(/\s+/g, ' ') ?? '';
  return name === '' ? null : name.slice(0, 40);
}

export interface MappedDossierAnswer {
  dossier: Dossier;
  area: string | null;
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
    dossier: toDossier(answer.dossier, input, refs, now),
    area: toArea(answer.area),
    flags: toFlags(answer.flags, memberKeys),
    facts: toCandidates(answer.facts, input.topic.id, refs),
    closeFacts,
    confirmedFactIds: toConfirmed(answer.confirmedFactIds, input, refs, closeFacts),
  };
}
