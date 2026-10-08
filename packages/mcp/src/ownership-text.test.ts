import type { ReviewOwnership } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { effortText, ownershipLines, ownershipShort } from './ownership-text.ts';

const workflow = { path: '.github/workflows/container-images-cd.yml', additions: 12, deletions: 3 };
const appFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map((path) => ({ path, additions: 60, deletions: 20 }));

const ownership: ReviewOwnership = {
  owners: [
    { owner: 'acme/team-devex', requested: true, files: [workflow] },
    { owner: 'acme/team-core', requested: false, files: appFiles },
  ],
  yours: [workflow],
  filesListed: 7,
  filesTotal: 7,
};

const size = { additions: 410, deletions: 120, changedFiles: 7 };

describe('ownership text', () => {
  it('names up to three paths per team in brief, all of them in full', () => {
    expect(ownershipLines(ownership, false)).toEqual([
      'Code owners (CODEOWNERS on the default branch):',
      '  team-devex: 1 of 7 files (.github/workflows/container-images-cd.yml)',
      '  team-core (not requested): 6 of 7 files (a.ts, b.ts, c.ts +3 more)',
    ]);
    expect(ownershipLines(ownership, true)[2]).toBe('  team-core (not requested): 6 of 7 files (a.ts, b.ts, c.ts, d.ts, e.ts, f.ts)');
  });

  it('says so when only the first files were checked', () => {
    const capped = { ...ownership, filesListed: 100, filesTotal: 250 };
    expect(ownershipLines(capped, false)[0]).toBe('Code owners (CODEOWNERS on the default branch) (only the first 100 checked):');
    expect(ownershipShort(capped)).toBe('team-devex owns 1 of 250 files, team-core owns 6 of 250 files (only the first 100 checked)');
  });

  it('says nothing without CODEOWNERS', () => {
    expect(ownershipLines(null, true)).toEqual([]);
    expect(ownershipShort(null)).toBe('');
  });

  it("sizes the user's part against the whole PR, with the open threads", () => {
    expect(effortText(size, ownership, 2)).toBe("effort: 1 file, +12 -3 in your team's area (PR +410 -120, 7 files); 2 open threads");
    expect(effortText(size, { ...ownership, yours: [] }, 0)).toBe("effort: nothing in your team's area (PR +410 -120, 7 files)");
    expect(effortText(size, null, 1)).toBe('effort: PR +410 -120, 7 files; 1 open thread');
  });
});
