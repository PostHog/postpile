import { describe, expect, it } from 'vitest';
import { FakeEngine } from '@postpile/server';
import { formatSync } from './format.ts';
import { formatTools } from './format-tools.ts';

describe('formatTools', () => {
  it('prints each tool with its fix commands', async () => {
    const engine = new FakeEngine({ missingTools: ['gh', 'claude'], setupStepMs: 0 });
    const text = formatTools(await engine.tools());
    expect(text).toContain('gh: missing · GitHub CLI (gh) not found');
    expect(text).toContain('  fix: Install it: brew install gh');
    expect(text).toContain('claude: missing · Agent features are off: claude not found');
    expect(text).toContain('sync: off until gh works');
    expect(text).toContain('agent: off, rules only');
  });

  it('says why a sync was skipped and when it ran on rules only', async () => {
    const withoutGh = new FakeEngine({ missingTools: ['gh'], syncStepMs: 0 });
    expect(formatSync(await withoutGh.sync())).toBe('sync skipped: GitHub CLI (gh) not found (pnpm cli tools shows the fix)');
    const withoutClaude = new FakeEngine({ missingTools: ['claude'], syncStepMs: 0 });
    expect(formatSync(await withoutClaude.sync())).toContain('rules only: Agent features are off: claude not found');
  });
});
