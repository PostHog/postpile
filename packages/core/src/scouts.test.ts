import { describe, expect, it } from 'vitest';
import { parseScouts, type ScoutConfig } from './scouts-config.ts';
import {
  scheduleScoutWork,
  scoutedWantsGlance,
  isScoutedActive,
  isScoutedUnseen,
  scoutBodyHead,
  scoutDefinitionHash,
  scoutedExpiry,
  scoutInputHash,
  scoutJudgeStep,
  scoutListingFloor,
  scoutPrefilter,
  scoutPullStep,
  scoutRetentionCutoff,
  scoutSignals,
  type ScoutCandidate,
  type ScoutFile,
} from './scouts.ts';
import type { Viewer } from './types.ts';

function scout(paths: string): ScoutConfig {
  const text = `## Lookout\nrepos: acme/app\n${paths === '' ? '' : `paths: ${paths}\n`}\nWatch the shape of the app.\n`;
  const parsed = parseScouts(text);
  expect(parsed.errors).toEqual([]);
  return parsed.scouts[0]!;
}

function candidate(overrides: Partial<ScoutCandidate> = {}): ScoutCandidate {
  return {
    key: 'acme/app#10',
    title: 'Add a billing service',
    body: 'Adds the service.',
    author: 'carol',
    assignees: [],
    isDraft: false,
    state: 'OPEN',
    headOid: 'h1',
    baseOid: 'b1',
    updatedAt: '2026-10-29T10:00:00.000Z',
    mergedAt: null,
    ...overrides,
  };
}

const viewer: Viewer = { login: 'alice', teams: ['acme/devex'], homeTeams: ['acme/devex'], teamMembers: ['bob'] };

describe('scoutPrefilter', () => {
  const facts = { viewer, tracked: new Set(['acme/app#7']) };

  it('lets a person outside the team through', () => {
    expect(scoutPrefilter(candidate(), facts)).toBeNull();
  });

  it('leaves out drafts, the viewer, teammates and tracked PRs', () => {
    expect(scoutPrefilter(candidate({ isDraft: true }), facts)).toBe('draft');
    expect(scoutPrefilter(candidate({ author: 'Alice' }), facts)).toBe('you');
    expect(scoutPrefilter(candidate({ author: 'bob' }), facts)).toBe('your_team');
    expect(scoutPrefilter(candidate({ key: 'acme/app#7' }), facts)).toBe('tracked');
  });

  it('judges a merged PR that was a draft once (isDraft only holds an open one back)', () => {
    expect(scoutPrefilter(candidate({ state: 'MERGED', isDraft: true }), facts)).toBeNull();
  });

  it('leaves out dependency and merge-queue bots but not agent accounts', () => {
    expect(scoutPrefilter(candidate({ author: 'dependabot[bot]' }), facts)).toBe('dependency_bot');
    expect(scoutPrefilter(candidate({ author: 'renovate[bot]' }), facts)).toBe('dependency_bot');
    expect(scoutPrefilter(candidate({ author: 'trunk-io[bot]' }), facts)).toBe('dependency_bot');
    expect(scoutPrefilter(candidate({ author: 'mergify' }), facts)).toBe('dependency_bot');
    expect(scoutPrefilter(candidate({ author: 'copilot-swe-agent[bot]' }), facts)).toBeNull();
    expect(scoutPrefilter(candidate({ author: 'codegen-agent[bot]' }), facts)).toBeNull();
  });

  it('counts an agent PR as its assignees\' work, like every ownership rule', () => {
    expect(scoutPrefilter(candidate({ author: 'codegen-agent[bot]', assignees: ['bob'] }), facts)).toBe('your_team');
    expect(scoutPrefilter(candidate({ author: 'codegen-agent[bot]', assignees: ['alice'] }), facts)).toBe('you');
    expect(scoutPrefilter(candidate({ author: 'codegen-agent[bot]', assignees: ['dmitri'] }), facts)).toBeNull();
    // A person's PR stays theirs whoever it is assigned to.
    expect(scoutPrefilter(candidate({ author: 'carol', assignees: ['bob'] }), facts)).toBeNull();
  });

  it('has no teammates before the member list is known', () => {
    expect(scoutPrefilter(candidate({ author: 'bob' }), { viewer: { login: 'alice', teams: [] }, tracked: new Set() })).toBeNull();
  });
});

describe('scoutSignals', () => {
  const base = new Set(['src', 'docs', 'services']);
  const files = (...entries: [string, ScoutFile['changeType']][]): ScoutFile[] => entries.map(([path, changeType]) => ({ path, changeType }));

  it('matches plain hints on any change and "+" hints on added files only', () => {
    const lookout = scout('+services/*/api/**, docs/architecture.md');
    const signals = scoutSignals(
      lookout,
      files(['services/billing/api/routes.ts', 'ADDED'], ['services/billing/api/old.ts', 'MODIFIED'], ['docs/architecture.md', 'MODIFIED'], ['src/app.ts', 'MODIFIED']),
      base,
    );
    expect(signals).toEqual([
      { path: 'services/billing/api/routes.ts', changeType: 'ADDED', hint: '+services/*/api/**' },
      { path: 'docs/architecture.md', changeType: 'MODIFIED', hint: 'docs/architecture.md' },
    ]);
  });

  it('counts a renamed-to file as added', () => {
    expect(scoutSignals(scout('+services/**'), files(['services/x.ts', 'RENAMED']), base)).toHaveLength(1);
  });

  it('finds a new top-level folder against the base tree', () => {
    const lookout = scout('+*/');
    const signals = scoutSignals(lookout, files(['billing/main.ts', 'ADDED'], ['src/new.ts', 'ADDED'], ['README.md', 'ADDED'], ['tools/x.ts', 'MODIFIED']), base);
    expect(signals).toEqual([{ path: 'billing/main.ts', changeType: 'ADDED', hint: '+*/' }]);
  });

  it('takes each file once, by the first hint that matches', () => {
    const signals = scoutSignals(scout('docs/**, docs/architecture.md'), files(['docs/architecture.md', 'MODIFIED']), base);
    expect(signals).toEqual([{ path: 'docs/architecture.md', changeType: 'MODIFIED', hint: 'docs/**' }]);
  });
});

describe('scoutInputHash', () => {
  const lookout = scout('docs/**');
  const docs: ScoutFile[] = [{ path: 'docs/a.md', changeType: 'MODIFIED' }];
  const signals = scoutSignals(lookout, [...docs, { path: 'src/x.ts', changeType: 'MODIFIED' }], new Set());

  it('stays the same for files outside the signals and for content changes in the same files', () => {
    const before = scoutInputHash(lookout, candidate(), docs, signals);
    const withMore = scoutInputHash(lookout, candidate(), [...docs, { path: 'src/y.ts', changeType: 'ADDED' }], signals);
    expect(withMore).toBe(before);
  });

  it('moves with a new matched pair, the title, the body head and the scout definition', () => {
    const before = scoutInputHash(lookout, candidate(), docs, signals);
    const added = scoutSignals(lookout, [...docs, { path: 'docs/b.md', changeType: 'ADDED' }], new Set());
    expect(scoutInputHash(lookout, candidate(), docs, added)).not.toBe(before);
    expect(scoutInputHash(lookout, candidate({ title: 'Other' }), docs, signals)).not.toBe(before);
    expect(scoutInputHash(lookout, candidate({ body: 'Changed text' }), docs, signals)).not.toBe(before);
    expect(scoutInputHash({ ...lookout, prompt: 'Something else' }, candidate(), docs, signals)).not.toBe(before);
  });

  it('ignores the body past the head', () => {
    const long = 'x'.repeat(700);
    expect(scoutInputHash(lookout, candidate({ body: `${long}a` }), docs, signals)).toBe(scoutInputHash(lookout, candidate({ body: `${long}b` }), docs, signals));
    expect(scoutBodyHead(`  ${long}`)).toHaveLength(600);
  });

  it('covers the whole file list for a scout without paths', () => {
    const open = scout('');
    const before = scoutInputHash(open, candidate(), docs, []);
    expect(scoutInputHash(open, candidate(), [...docs, { path: 'src/y.ts', changeType: 'ADDED' }], [])).not.toBe(before);
  });

  it('does not change with a rename of the scout', () => {
    expect(scoutDefinitionHash({ ...lookout, name: 'Renamed' } as ScoutConfig)).toBe(scoutDefinitionHash(lookout));
  });
});

describe('scoutJudgeStep', () => {
  const base = { existing: null, pulledByThisScout: false, inputHash: 'h1', hasPathHints: true, signals: 1 };

  it('judges a PR the scout never saw', () => {
    expect(scoutJudgeStep(base)).toBe('judge');
  });

  it('leaves a PR this scout pulled to the refresh', () => {
    expect(scoutJudgeStep({ ...base, pulledByThisScout: true })).toBe('already_pulled');
  });

  it('judges again only when the input moved', () => {
    expect(scoutJudgeStep({ ...base, existing: { status: 'judged', inputHash: 'h1' } })).toBe('unchanged');
    expect(scoutJudgeStep({ ...base, existing: { status: 'judged', inputHash: 'h0' } })).toBe('judge');
  });

  it('always works on a pending judgement', () => {
    expect(scoutJudgeStep({ ...base, existing: { status: 'pending', inputHash: 'h1' } })).toBe('judge');
  });

  it('skips by rule when hints exist and none matched', () => {
    expect(scoutJudgeStep({ ...base, signals: 0 })).toBe('no_signal');
    expect(scoutJudgeStep({ ...base, hasPathHints: false, signals: 0 })).toBe('judge');
  });
});

describe('scoutListingFloor', () => {
  it('looks a day back on the first run, else the overlap below the cursor', () => {
    expect(scoutListingFloor(null, '2026-10-29T12:00:00.000Z')).toBe('2026-10-28T12:00:00.000Z');
    expect(scoutListingFloor('2026-10-29T11:00:00.000Z', '2026-10-29T12:00:00.000Z')).toBe('2026-10-29T10:55:00.000Z');
  });
});

describe('scoutRetentionCutoff', () => {
  it('is 30 days back', () => {
    expect(scoutRetentionCutoff('2026-10-31T00:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('scoutedExpiry', () => {
  const active = { followedAt: null, dismissedAt: null, expiredAt: null };
  const now = '2026-10-29T12:00:00.000Z';

  it('keeps an open PR with activity in the last three days', () => {
    expect(scoutedExpiry(active, { state: 'OPEN', updatedAt: '2026-10-27T12:00:00.000Z', mergedAt: null }, now)).toBeNull();
  });

  it('expires an open PR three days without activity', () => {
    expect(scoutedExpiry(active, { state: 'OPEN', updatedAt: '2026-10-26T12:00:00.000Z', mergedAt: null }, now)).toBe('inactive');
  });

  it('keeps a merged PR for three days after the merge, whatever came after', () => {
    expect(scoutedExpiry(active, { state: 'MERGED', updatedAt: '2026-10-29T11:00:00.000Z', mergedAt: '2026-10-27T12:00:00.000Z' }, now)).toBeNull();
    expect(scoutedExpiry(active, { state: 'MERGED', updatedAt: '2026-10-29T11:00:00.000Z', mergedAt: '2026-10-26T11:00:00.000Z' }, now)).toBe('merged');
  });

  it('expires a closed PR three days after the close', () => {
    expect(scoutedExpiry(active, { state: 'CLOSED', updatedAt: '2026-10-26T11:00:00.000Z', mergedAt: null }, now)).toBe('closed');
  });

  it('never expires a followed, dismissed or expired one again', () => {
    const old = { state: 'OPEN' as const, updatedAt: '2026-10-01T00:00:00.000Z', mergedAt: null };
    expect(scoutedExpiry({ ...active, followedAt: now }, old, now)).toBeNull();
    expect(scoutedExpiry({ ...active, dismissedAt: now }, old, now)).toBeNull();
    expect(scoutedExpiry({ ...active, expiredAt: now }, old, now)).toBeNull();
  });
});

describe('scoutPullStep', () => {
  it('lets the first scout pull and keeps it there', () => {
    expect(scoutPullStep(null, 'lookout')).toBe('pull');
    expect(scoutPullStep({ scoutId: 'lookout' }, 'lookout')).toBe('already_pulled');
    expect(scoutPullStep({ scoutId: 'lookout' }, 'billing')).toBe('pulled_by_other');
  });
});

describe('isScoutedActive and isScoutedUnseen', () => {
  it('is active until followed, dismissed or expired', () => {
    expect(isScoutedActive({ followedAt: null, dismissedAt: null, expiredAt: null })).toBe(true);
    expect(isScoutedActive({ followedAt: null, dismissedAt: '2026-10-29T00:00:00.000Z', expiredAt: null })).toBe(false);
  });

  it('reads unseen until seen, and again after newer activity', () => {
    expect(isScoutedUnseen({ seenUpdatedAt: null }, '2026-10-29T10:00:00.000Z')).toBe(true);
    expect(isScoutedUnseen({ seenUpdatedAt: '2026-10-29T10:00:00.000Z' }, '2026-10-29T10:00:00.000Z')).toBe(false);
    expect(isScoutedUnseen({ seenUpdatedAt: '2026-10-29T10:00:00.000Z' }, '2026-10-29T11:00:00.000Z')).toBe(true);
  });
});

describe('scheduleScoutWork', () => {
  const item = (id: string, pending: boolean, observedUpdatedAt = '2026-10-29T10:00:00.000Z', stalled = false) => ({ id, pending, observedUpdatedAt, stalled });

  it('takes pending retries first, oldest observed first, then new candidates', () => {
    const queue = [item('new1', false), item('old', true, '2026-10-20T00:00:00.000Z'), item('older', true, '2026-10-10T00:00:00.000Z'), item('new2', false)];
    expect([...scheduleScoutWork([queue], 3)].map((entry) => entry.id)).toEqual(['older', 'old', 'new1']);
  });

  it('puts retries whose reads failed behind new candidates, so they never hold every slot', () => {
    const stalled = Array.from({ length: 5 }, (_, index) => item(`s${index}`, true, '2026-10-01T00:00:00.000Z', true));
    const queue = [...stalled, item('new1', false), item('retry', true, '2026-10-20T00:00:00.000Z')];
    expect([...scheduleScoutWork([queue], 3)].map((entry) => entry.id)).toEqual(['retry', 'new1', 's0']);
  });

  it('shares the capacity round-robin across scouts and repos', () => {
    const lookout = Array.from({ length: 50 }, (_, index) => item(`l${index}`, false));
    const billing = [item('b0', true), item('b1', false)];
    const docs = [item('d0', false)];
    expect([...scheduleScoutWork([lookout, billing, docs], 5)].map((entry) => entry.id)).toEqual(['l0', 'b0', 'd0', 'l1', 'b1']);
  });

  it('takes nothing without capacity, and everything when it fits', () => {
    expect(scheduleScoutWork([[item('a', false)]], 0).size).toBe(0);
    expect(scheduleScoutWork([[item('a', false)], [item('b', true)]], 10).size).toBe(2);
  });
});

describe('scoutedWantsGlance', () => {
  it('wants a glance while on the Scouted section, merged or not', () => {
    expect(scoutedWantsGlance({ followedAt: null, dismissedAt: null, expiredAt: null })).toBe(true);
    expect(scoutedWantsGlance({ followedAt: null, dismissedAt: null, expiredAt: '2026-10-29T00:00:00.000Z' })).toBe(false);
  });
});

