import { describe, expect, it } from 'vitest';
import type { ArmSnapshot, SnapshotTile } from '@postpile/engine';
import { formatReportMarkdown } from './report-markdown.ts';
import { buildReport, glanceAgreement, multiPrTiles, summarizeCalls, tileChurn, type ReportMeta } from './report.ts';

function snapshot(tiles: SnapshotTile[], overrides: Partial<ArmSnapshot> = {}): ArmSnapshot {
  return { topics: [{ id: 'ci', name: 'CI | runners', tiles }], glances: {}, dossiers: {}, calls: [], setChanges: null, ...overrides };
}

function single(key: string): SnapshotTile {
  return { id: `pr:${key}`, kind: 'single', members: [key] };
}

const META: ReportMeta = {
  from: '/scratch/source.sqlite',
  out: '/scratch/out',
  now: '2026-09-29T12:00:00.000Z',
  days: 7,
  roundSize: 60,
  arms: ['old', 'combined'],
  dryRun: false,
  plannedRounds: 2,
  plannedPrs: { pinged: 3, found: 0, pulledIn: 0 },
};

describe('summarizeCalls', () => {
  it('counts calls by kind with failures, cost and time', () => {
    const summary = summarizeCalls([
      { kind: 'glance_batch', ok: true, durationMs: 1000, costUsd: 0.5 },
      { kind: 'glance_batch', ok: false, durationMs: 500, costUsd: null },
      { kind: 'dossier_update', ok: true, durationMs: 2000, costUsd: 0.25 },
    ]);
    expect(summary).toEqual({ calls: 3, failed: 1, costUsd: 0.75, durationMs: 3500, byKind: { glance_batch: 2, dossier_update: 1 } });
  });
});

describe('tileChurn', () => {
  it('counts kept, new and gone tiles and names PRs that changed tile, with set change reasons', () => {
    const before = snapshot([single('acme/app#1'), single('acme/app#2'), single('acme/app#3')]);
    const after = snapshot([{ id: 'set:s1', kind: 'set', members: ['acme/app#1', 'acme/app#2'] }, single('acme/app#3'), single('acme/app#4')], {
      setChanges: [{ setId: 's1', topicId: 'ci', prKey: 'acme/app#1', change: 'added', reason: 'same runner image', by: 'agent', at: '2026-09-29T12:01:00Z' }],
    });
    const churn = tileChurn(before, after);
    expect(churn).toMatchObject({ kept: 1, added: 2, gone: 2 });
    expect(churn.moved).toEqual([
      { prKey: 'acme/app#1', from: 'pr:acme/app#1 in ci', to: 'set:s1 in ci', reasons: ['added s1 by agent: same runner image'] },
      { prKey: 'acme/app#2', from: 'pr:acme/app#2 in ci', to: 'set:s1 in ci', reasons: [] },
    ]);
  });

  it('counts every tile as new in the first round', () => {
    expect(tileChurn(null, snapshot([single('acme/app#1')]))).toEqual({ kept: 0, added: 1, gone: 0, moved: [] });
  });

  it('counts a PR that changed topic under the same tile id as moved, not kept', () => {
    const before = snapshot([], { topics: [{ id: 'unsorted', name: 'Unsorted', tiles: [single('acme/app#1')] }] });
    const after = snapshot([single('acme/app#1')]);
    expect(tileChurn(before, after)).toEqual({
      kept: 0,
      added: 1,
      gone: 1,
      moved: [{ prKey: 'acme/app#1', from: 'pr:acme/app#1 in unsorted', to: 'pr:acme/app#1 in ci', reasons: [] }],
    });
  });

  it('counts a stack that shows in two topics once', () => {
    const stack: SnapshotTile = { id: 'stack:a', kind: 'stack', members: ['acme/app#1', 'acme/app#2'] };
    const twoTopics = snapshot([], {
      topics: [
        { id: 'ci', name: 'CI', tiles: [stack] },
        { id: 'docs', name: 'Docs', tiles: [stack] },
      ],
    });
    expect(tileChurn(twoTopics, twoTopics)).toEqual({ kept: 1, added: 0, gone: 0, moved: [] });
    expect(multiPrTiles(twoTopics)).toEqual({ stack: 1 });
    const report = buildReport({ ...META, arms: ['old'] }, [{ index: 1, startAt: '2026-09-29T12:00:00.000Z', prs: { pinged: 2, found: 0, pulledIn: 0 }, arms: { old: twoTopics } }]);
    expect(report.rounds[0]!.arms.old).toMatchObject({ topics: 2, tiles: 1, multiPr: { stack: 1 }, churn: { kept: 0, added: 1, gone: 0 } });
  });
});

describe('multiPrTiles', () => {
  it('counts tiles with more than one PR by kind', () => {
    const tiles: SnapshotTile[] = [
      { id: 'stack:a', kind: 'stack', members: ['acme/app#1', 'acme/app#2'] },
      { id: 'set:s1', kind: 'set', members: ['acme/app#3', 'acme/app#4'] },
      single('acme/app#5'),
    ];
    expect(multiPrTiles(snapshot(tiles))).toEqual({ stack: 1, set: 1 });
  });
});

describe('glanceAgreement', () => {
  it('compares PRs glanced in every arm and lists the differences', () => {
    const old = snapshot([], {
      glances: {
        'acme/app#1': { verdict: 'LOOKS_SAFE', risk: 'Low.' },
        'acme/app#2': { verdict: 'LOOK_CLOSER', risk: 'High: migration.' },
        'acme/app#3': { verdict: 'LOOKS_SAFE', risk: 'Low.' },
      },
    });
    const combined = snapshot([], {
      glances: {
        'acme/app#1': { verdict: 'LOOKS_SAFE', risk: 'Low, docs only.' },
        'acme/app#2': { verdict: 'LOOKS_SAFE', risk: 'Medium.' },
      },
    });
    const agreement = glanceAgreement({ old, combined });
    expect(agreement).toMatchObject({ compared: 2, verdictSame: 1, riskSame: 1 });
    expect(agreement.differences).toEqual([
      { prKey: 'acme/app#2', byArm: { old: { verdict: 'LOOK_CLOSER', riskLevel: 'high' }, combined: { verdict: 'LOOKS_SAFE', riskLevel: 'medium' } } },
    ]);
  });
});

describe('buildReport and formatReportMarkdown', () => {
  it('adds up calls per arm and puts topics side by side', () => {
    const call = { kind: 'glance_batch', ok: true, durationMs: 60_000, costUsd: 0.1 };
    const records = [
      { index: 1, startAt: '2026-09-29T12:00:00.000Z', prs: { pinged: 2, found: 0, pulledIn: 0 }, arms: { old: snapshot([single('acme/app#1')], { calls: [call] }), combined: snapshot([single('acme/app#1')]) } },
      {
        index: 2,
        startAt: '2026-09-29T12:05:00.000Z',
        prs: { pinged: 1, found: 0, pulledIn: 0 },
        arms: {
          old: snapshot([single('acme/app#1')], { calls: [call, call], dossiers: { ci: { status: 'active', statusNote: 'Runner | image rollout', goal: 'Faster CI' } } }),
          combined: snapshot([single('acme/app#1')], { dossiers: { ci: { status: 'blocked', statusNote: 'Waits on review', goal: 'Faster CI' } } }),
        },
      },
    ];
    const report = buildReport(META, records);
    expect(report.totals.old).toMatchObject({ calls: 3, byKind: { glance_batch: 3 } });
    expect(report.totals.combined).toMatchObject({ calls: 0 });
    expect(report.topics).toHaveLength(1);
    const markdown = formatReportMarkdown(report);
    expect(markdown).toContain('| old | 3 | 0 | $0.30 | 3.0 min | glance_batch 3 |');
    expect(markdown).toContain('### CI \\| runners (`ci`)');
    expect(markdown).toContain('| status | active | blocked |');
    expect(markdown).toContain('| note | Runner \\| image rollout | Waits on review |');
  });
});
