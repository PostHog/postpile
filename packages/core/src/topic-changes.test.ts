import { describe, expect, it } from 'vitest';
import { emptyDossier } from './dossier.ts';
import { at, makeDossierVersion, makeFact } from './fixtures.ts';
import type { Cursor } from './memory.ts';
import { topicChangesSince } from './topic-changes.ts';

const seen: Cursor = { kind: 'seen', scope: 'topic-1', seq: 40, dossierVersion: 3, updatedAt: at(50) };

const latest = makeDossierVersion({
  version: 5,
  dossier: {
    ...emptyDossier(),
    recentChanges: [
      { at: at(70), text: 'Docker build PR opened', refs: [] },
      { at: at(60), text: 'image merged', refs: [] },
      { at: at(30), text: 'old news', refs: [] },
    ],
  },
});

describe('topicChangesSince', () => {
  it('is null when the topic was never marked seen', () => {
    expect(topicChangesSince(null, latest, [], 4)).toBeNull();
  });

  it('keeps changes and facts newer than the seen cursor', () => {
    const facts = [
      makeFact({ id: 'old', recordedAt: at(10) }),
      makeFact({ id: 'added', recordedAt: at(55) }),
      makeFact({ id: 'closed', recordedAt: at(10), expiredAt: at(65), invalidAt: at(65) }),
      makeFact({ id: 'both', recordedAt: at(55), expiredAt: at(66), invalidAt: at(66) }),
    ];
    const changes = topicChangesSince(seen, latest, facts, 4);
    expect(changes).toMatchObject({ since: at(50), fromVersion: 3, newEvents: 4 });
    expect(changes?.changes.map((change) => change.text)).toEqual(['Docker build PR opened', 'image merged']);
    expect(changes?.factsAdded.map((fact) => fact.id)).toEqual(['added']);
    expect(changes?.factsClosed.map((fact) => fact.id)).toEqual(['closed', 'both']);
  });
});
