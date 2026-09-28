import {
  describeFactRef,
  describeLineSources,
  dossierLineIssue,
  factCheck,
  findDossierLine,
  lineCheck,
  verifyFact,
  type MemorySources,
  type MemoryTarget,
  type PrEvent,
  type PrKey,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { verifyWorldFor } from './fact-world.ts';

/**
 * The "Why?" panel: the sources behind one fact or dossier line, read from
 * stored snapshots, plus whether it still checks out. Reads only.
 */
export class MemorySourcesReads {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  private eventsOf(prKeys: PrKey[]): Map<PrKey, PrEvent[]> {
    return new Map(prKeys.map((key) => [key, this.store.events.listForPr(key)]));
  }

  private fact(target: MemoryTarget & { kind: 'fact' }): MemorySources | null {
    const fact = this.store.facts.get(target.factId);
    if (!fact) {
      return null;
    }
    const world = verifyWorldFor(this.store, [fact], this.now().toISOString());
    const events = this.eventsOf([...new Set(fact.refs.map((ref) => ref.prKey))]);
    const sources = fact.refs
      .map((ref) => describeFactRef(ref, world.prs.get(ref.prKey), events.get(ref.prKey) ?? []))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { target, claim: fact.text, recordedIn: 'Fact', recordedAt: fact.recordedAt, sources, check: factCheck(fact, verifyFact(fact, world)) };
  }

  private dossierLine(target: MemoryTarget & { kind: 'dossier_line' }): MemorySources | null {
    const version = this.store.dossiers.get(target.topicId, target.version);
    const line = version ? findDossierLine(version.dossier, target.path) : null;
    if (!version || !line) {
      return null;
    }
    const memberKeys = this.store.memberships.listForTopic(target.topicId).map((membership) => membership.prKey);
    const refKeys = [...new Set(line.sources.refs.map((ref) => ref.prKey))];
    const prs = this.store.prs.getMany([...new Set([...memberKeys, ...refKeys])]);
    const world = { prs, memberKeys: new Set(memberKeys), now: this.now().toISOString() };
    const issue = dossierLineIssue(version.dossier, target.path, world);
    return {
      target,
      claim: line.text,
      recordedIn: `Dossier v${version.version}`,
      recordedAt: version.createdAt,
      sources: describeLineSources(line.sources, prs, this.eventsOf(refKeys)),
      check: lineCheck(line.sources, issue),
    };
  }

  get(target: MemoryTarget): MemorySources | null {
    return target.kind === 'fact' ? this.fact(target) : this.dossierLine(target);
  }
}
