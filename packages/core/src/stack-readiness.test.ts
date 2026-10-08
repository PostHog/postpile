import { describe, expect, it } from 'vitest';
import { at, makePr, makeTimelineItem } from './fixtures.ts';
import { landableBelow } from './stack-readiness.ts';
import type { FullPr, Pr } from './types.ts';

const approved = (number: number, overrides: Partial<FullPr> = {}) => makePr({ number, reviewDecision: 'APPROVED', ...overrides });
const waitingOnTeam = (number: number) => makePr({ number, reviewDecision: 'REVIEW_REQUIRED', reviewerTeams: ['acme/team-security'] });
const keys = (prs: Pr[]) => prs.map((pr) => pr.key);

describe('landableBelow', () => {
  it('names the approved bottom layer while the layer above waits on a team review', () => {
    expect(keys(landableBelow([approved(1), waitingOnTeam(2)]))).toEqual(['acme/app#1']);
  });

  it('is empty when the bottom layer itself is held, or nothing is', () => {
    expect(landableBelow([waitingOnTeam(1), approved(2)])).toEqual([]);
    expect(landableBelow([approved(1), approved(2)])).toEqual([]);
  });

  it('lists only the layers below the lowest held one, bottom first', () => {
    expect(keys(landableBelow([approved(1), approved(2), waitingOnTeam(3), approved(4)]))).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('leaves out merged, queued and unapproved layers below', () => {
    const merged = approved(1, { state: 'MERGED' });
    const queued = approved(2, { timeline: [makeTimelineItem({ kind: 'added_to_merge_queue', at: at(1) })] });
    const noReviewNeeded = makePr({ number: 3, reviewDecision: 'NONE' });
    expect(keys(landableBelow([merged, queued, noReviewNeeded, approved(4), waitingOnTeam(5)]))).toEqual(['acme/app#4']);
  });
});
