import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

function engine(extras: Set<'mcp'> = new Set(['mcp'])): FakeEngine {
  return new FakeEngine({ setupStepMs: 0, syncStepMs: 0, extras });
}

describe('POSTPILE_FAKE_EXTRA=mcp', () => {
  it('leaves the default sample without overlaps', async () => {
    expect(await engine(new Set()).prOverlaps()).toEqual({ overlaps: {}, capped: [] });
  });

  it('reports #1902 and #2301 on the same lines, both ways', async () => {
    const { overlaps } = await engine().prOverlaps();
    expect(overlaps['acme/app#1902']?.map((overlap) => overlap.other)).toEqual(['acme/app#2301']);
    expect(overlaps['acme/app#1902']?.[0]?.files[0]?.path).toBe('.github/workflows/ci-backend.yml');
    expect(overlaps['acme/app#2301']?.map((overlap) => overlap.other)).toEqual(['acme/app#1902']);
  });

  it('reports a nearby pair, but neither the lockfile pair nor stack mates', async () => {
    const { overlaps } = await engine().prOverlaps();
    expect(overlaps['acme/app#1982']).toEqual([expect.objectContaining({ other: 'acme/app#1978', files: [] })]);
    expect(overlaps['acme/app#1921']).toBeUndefined();
    expect(overlaps['acme/app#1904']).toBeUndefined();
    expect(overlaps['acme/app#1907']).toBeUndefined();
    expect(overlaps['acme/app#1911']).toBeUndefined();
  });

  it('marks one capped diff', async () => {
    expect((await engine().prOverlaps()).capped).toEqual(['acme/app#1934']);
  });

  it("puts sol's #2301 in the Depot topic", async () => {
    const pr = await engine().getPr('acme/app#2301');
    expect(pr?.pr.author).toBe('sol');
    expect(pr?.topicId).toBe('topic-depot');
  });
});
