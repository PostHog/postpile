// Shared plumbing for the opt-in sample packs (fake-extras.ts): a pack is a
// handful of topics, PRs, events, glances, tiles and user states that get
// appended to the default sample, plus the memory (relations, dossiers) the
// topics need for their placement.
import type { DossierRelation, DossierVersion, FullPr, Glance, PrEvent, PrSet, Tile, Topic, UserPrState } from '@postpile/core';
import { sampleKey } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';
import type { SampleMemory } from './sample-memory.ts';

export interface SamplePack {
  topics: Topic[];
  prs: FullPr[];
  events: PrEvent[];
  glances: Glance[];
  tiles: Tile[];
  /** The agent-grouped sets behind the pack's set tiles. */
  sets: PrSet[];
  userStates: UserPrState[];
}

export interface SamplePackMemory {
  /** Placement of topics without a dossier. */
  relations: Map<string, DossierRelation>;
  /** Every stored version per topic, oldest first. */
  dossiers: Map<string, DossierVersion[]>;
}

/** Appends the pack to the sample. A PR's topic is the first tile that holds it, like `buildMembership`. */
export function addSamplePack(data: SampleData, pack: SamplePack): void {
  data.topics.push(...pack.topics);
  data.prs.push(...pack.prs);
  data.events.push(...pack.events);
  data.glances.push(...pack.glances);
  data.tiles.push(...pack.tiles);
  data.sets.push(...pack.sets);
  data.userStates.push(...pack.userStates);
  for (const tile of pack.tiles) {
    for (const member of tile.members) {
      if (!data.membership.has(member.prKey)) {
        data.membership.set(member.prKey, tile.topicId);
      }
    }
  }
}

export function addSamplePackMemory(memory: SampleMemory, pack: SamplePackMemory): void {
  for (const [topicId, relation] of pack.relations) {
    memory.relations.set(topicId, relation);
  }
  for (const [topicId, versions] of pack.dossiers) {
    memory.dossiers.set(topicId, versions);
  }
}

/** A user state with the viewer's approval of the PR's head (`sha<number>`), like the default sample's. */
export function approvedState(number: number, approvedAt: string, handledAt: string | null = null): UserPrState {
  return { prKey: sampleKey(number), approvedAt, approvedCommitOid: `sha${number}`, handledAt };
}
