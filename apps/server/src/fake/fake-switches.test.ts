// Small fake-mode switches: POSTPILE_FAKE_UPDATE=many and POSTPILE_SWEEP_SKIP
// in the sample work context.
import { describe, expect, it } from 'vitest';
import { FakeUpdates } from './fake-update.ts';
import { FakeWorkContext } from './fake-work-context.ts';

const NOW = new Date('2026-09-29T12:00:00Z');

function workContext(env: NodeJS.ProcessEnv): FakeWorkContext {
  return new FakeWorkContext([], () => NOW, 0, env);
}

describe('POSTPILE_FAKE_UPDATE=many', () => {
  it('is more releases behind than one page of the release list holds ("10+")', () => {
    expect(new FakeUpdates('0.12.4', 'many').status().latest).toMatchObject({ version: '0.12.16', releasesBehind: 10, moreBehind: true });
  });
});

describe('the sample work context skip list', () => {
  it('shows the defaults until a list is saved', () => {
    expect(workContext({}).view()).toMatchObject({ skipPatterns: ['personal', 'private'], skipSource: 'default' });
    const context = workContext({});
    context.setSkip(['taxes', ' ']);
    expect(context.view()).toMatchObject({ skipPatterns: ['taxes'], skipSource: 'config' });
  });

  it('takes POSTPILE_SWEEP_SKIP over a saved list and says so when saving', () => {
    const context = workContext({ POSTPILE_SWEEP_SKIP: 'secret, tax' });
    expect(context.setSkip(['taxes']).message).toContain('POSTPILE_SWEEP_SKIP is set and still wins');
    const view = context.view();
    expect(view).toMatchObject({ skipPatterns: ['secret', 'tax'], skipSource: 'env' });
    expect(view.current?.inputStats.skipPatterns).toEqual(['secret', 'tax']);
  });

  it('skips nothing when POSTPILE_SWEEP_SKIP is empty', () => {
    expect(workContext({ POSTPILE_SWEEP_SKIP: '' }).view()).toMatchObject({ skipPatterns: [], skipSource: 'env' });
  });
});
