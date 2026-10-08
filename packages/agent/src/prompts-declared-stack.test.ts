import type { DeclaredParentNote, DependsOnNote } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { glanceBatchPrompt } from './prompts/glance-batch.ts';
import type { GlanceBatchItem } from './service.ts';
import { emptyContext, makePr, viewer } from './test-fixtures.ts';

const PR = makePr({ ref: { repo: 'acme/app', number: 21 }, body: 'Stacked on #20. No CI changes in this layer.' });

function prompt(declaredParent?: DeclaredParentNote, dependsOn?: DependsOnNote): string {
  const item: GlanceBatchItem = { pr: PR, provenance: { kind: 'pinged', reason: 'review_requested' }, declaredParent, dependsOn };
  return glanceBatchPrompt({ topic: null, dossier: null, items: [item], viewer, context: emptyContext, attempt: 1 });
}

const DRAFT_PARENT: DeclaredParentNote = { number: 20, state: 'draft', commits: 3, sharedCommits: 2, sharedFiles: ['.github/workflows/ci.yml'] };

describe('glance prompt for a stack declared in the body', () => {
  it('says the diff holds the parent, that merging lands it, and which files likely come from it', () => {
    const text = prompt(DRAFT_PARENT);
    expect(text).toContain("it names #20 (draft) as the PR below it, but its base is no PR's branch");
    expect(text).toContain("GitHub's diff and changed files here include #20's changes, and merging this PR also lands #20.");
    expect(text).toContain("2 of its 3 commits are also #20's.");
    expect(text).toContain('<github_data>\n.github/workflows/ci.yml\n</github_data>');
    expect(text).toContain('say in forYou that merging this PR also lands #20');
  });

  it('hedges when the PR shares no commits with the parent', () => {
    const text = prompt({ ...DRAFT_PARENT, sharedCommits: 0, sharedFiles: [] });
    expect(text).toContain("It shares none of its commits with #20, so its diff may not include #20's changes");
    expect(text).not.toContain('likely from #20');
  });

  it('says a merged parent is in already', () => {
    expect(prompt({ ...DRAFT_PARENT, state: 'merged' })).toContain('#20 has merged already');
  });

  it('adds nothing for a PR without one', () => {
    expect(prompt()).not.toContain('Stack declared in the description');
  });

  it('calls a "depends on" without shared commits a merge order, not a stack', () => {
    const text = prompt(undefined, { number: 20, state: 'open' });
    expect(text).toContain('Merge order declared in the description: it depends on #20 (open), which should merge first.');
    expect(text).toContain("so this is no stack and #20's changes are not in this PR's diff");
    expect(text).not.toContain('Stack declared in the description');
    expect(prompt(undefined, { number: 20, state: null })).toContain('it depends on #20, which should merge first.');
  });
});
