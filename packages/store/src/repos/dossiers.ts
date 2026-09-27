import type { DatabaseSync } from 'node:sqlite';
import type { DossierVersion } from '@code-manager/core';

/** Topic dossiers. Every version is kept; the newest is the one in use. */
export class DossierRepo {
  constructor(private readonly db: DatabaseSync) {}

  latest(topicId: string): DossierVersion | null {
    throw new Error('not implemented: DossierRepo.latest');
  }

  /** Newest version per topic. Topics without a dossier are missing from the map. */
  latestMany(topicIds: string[]): Map<string, DossierVersion> {
    throw new Error('not implemented: DossierRepo.latestMany');
  }

  get(topicId: string, version: number): DossierVersion | null {
    throw new Error('not implemented: DossierRepo.get');
  }

  /** Newest first. */
  listVersions(topicId: string, limit: number): DossierVersion[] {
    throw new Error('not implemented: DossierRepo.listVersions');
  }

  /**
   * Stores the next version. Throws unless version is latest + 1 (or 1 for the
   * first), so two writers cannot both write version N.
   */
  add(version: DossierVersion): void {
    throw new Error('not implemented: DossierRepo.add');
  }

  /** Number of stored versions, for pruning. */
  countVersions(topicId: string): number {
    throw new Error('not implemented: DossierRepo.countVersions');
  }

  /** Deletes all but the newest `keep` versions of a topic. Returns how many went. */
  prune(topicId: string, keep: number): number {
    throw new Error('not implemented: DossierRepo.prune');
  }
}
