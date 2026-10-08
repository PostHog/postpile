import { describe, expect, it } from 'vitest';
import type { Glance } from '@postpile/core';
import { briefGlanceLines, glanceLines } from './text.ts';

const glance: Glance = {
  prKey: 'acme/app#7',
  verdict: 'LOOK_CLOSER',
  forYou: 'The description may not mention the workflow edit.',
  does: 'Moves the build to a new runner.',
  risk: 'medium - runner change',
  othersSaid: 'nobody yet',
  keyFiles: [],
  pullInReason: null,
  dossierVersion: null,
  inputHash: 'h1',
  model: 'claude-sonnet-5-5',
  createdAt: '2026-10-08T09:00:00.000Z',
};

describe('glance lines and the claim basis', () => {
  const basis = { risk: { checked: true, note: 'changed files' }, verdict: { checked: false, note: 'inferred from the description' } };

  it('says which claims were checked, brief and full', () => {
    const brief = briefGlanceLines({ ...glance, basis }, false);
    expect(brief).toContain('  for you: The description may not mention the workflow edit. (not checked: inferred from the description)');
    expect(brief).toContain('  risk: medium - runner change (checked: changed files)');
    const full = glanceLines({ ...glance, basis }, false);
    expect(full).toContain('  risk: medium - runner change (checked: changed files)');
    expect(full).toContain('  for you: The description may not mention the workflow edit. (not checked: inferred from the description)');
  });

  it('adds nothing for a glance written before the basis, or a side the answer left out', () => {
    expect(briefGlanceLines(glance, false)).toEqual([
      'Agent glance (LOOK_CLOSER, 2026-10-08):',
      '  for you: The description may not mention the workflow edit.',
      '  risk: medium - runner change',
    ]);
    const riskOnly = glanceLines({ ...glance, basis: { risk: { checked: false, note: '' }, verdict: null } }, false);
    expect(riskOnly).toContain('  risk: medium - runner change (not checked)');
    expect(riskOnly).toContain('  for you: The description may not mention the workflow edit.');
  });
});
