import { describe, expect, it } from 'vitest';
import type { ToolsView } from '@postpile/core';
import { TOOL_PATH_HINT } from '@postpile/core';
import { checkLine, claudeDetailUnderGh, retryLine, toolsFooter, toolsNotice, toolsRefetchMs } from './tools.ts';

function view(overrides: { gh?: Partial<ToolsView['gh']>; claude?: Partial<ToolsView['claude']>; checkedAt?: string | null; nextCheckAt?: string | null } = {}): ToolsView {
  return {
    gh: { state: 'ok', path: '/opt/homebrew/bin/gh', headline: 'GitHub CLI ready', detail: '', fixes: [], retryAt: null, ...overrides.gh },
    claude: { state: 'ok', path: '/usr/local/bin/claude', headline: 'Claude Code CLI ready', detail: '', fixes: [], retryAt: null, ...overrides.claude },
    canSync: true,
    agentOn: true,
    checkedAt: overrides.checkedAt ?? null,
    nextCheckAt: overrides.nextCheckAt ?? null,
  };
}

const missingGh = { state: 'missing' as const, headline: 'GitHub CLI (gh) not found' };
const missingClaude = { state: 'missing' as const, headline: 'Agent features are off: claude not found' };

describe('toolsNotice', () => {
  it('has nothing to say while all is well or not loaded', () => {
    expect(toolsNotice(undefined)).toEqual({ gh: null, claude: null });
    expect(toolsNotice(view())).toEqual({ gh: null, claude: null });
  });

  it('picks the tools that need a fix; offline gh is left to the footer', () => {
    expect(toolsNotice(view({ gh: missingGh })).gh?.headline).toBe('GitHub CLI (gh) not found');
    expect(toolsNotice(view({ gh: { state: 'offline' } })).gh).toBeNull();
    expect(toolsNotice(view({ claude: { state: 'limited' } })).claude?.state).toBe('limited');
  });
});

describe('toolsRefetchMs', () => {
  it('asks often while something is wrong', () => {
    expect(toolsRefetchMs(view())).toBe(300_000);
    expect(toolsRefetchMs(view({ claude: missingClaude }))).toBe(30_000);
    expect(toolsRefetchMs(view({ gh: { state: 'offline' } }))).toBe(30_000);
  });
});

describe('retryLine and checkLine', () => {
  const now = new Date(2026, 8, 28, 15, 15);

  it('says when a limited agent is tried again', () => {
    expect(retryLine(new Date(2026, 8, 28, 15, 40).toISOString(), now)).toBe('Trying again at 15:40, in 25 min.');
    expect(retryLine(new Date(2026, 8, 28, 15, 0).toISOString(), now)).toBe('Trying again with the next agent call.');
    expect(retryLine(null, now)).toBe('');
  });

  it('says when it last looked and when it looks again', () => {
    const checked = view({ checkedAt: new Date(2026, 8, 28, 15, 13).toISOString(), nextCheckAt: new Date(2026, 8, 28, 15, 17).toISOString() });
    expect(checkLine(checked, now)).toBe('Checked 2m ago. Looks again by itself at 15:17.');
    expect(checkLine(view({ checkedAt: now.toISOString() }), now)).toBe('Checked just now.');
  });
});

describe('toolsFooter', () => {
  it('stays quiet while all is well', () => {
    expect(toolsFooter(view())).toBeNull();
    expect(toolsFooter(undefined)).toBeNull();
  });

  it('names what is off, with the headlines as the tooltip', () => {
    expect(toolsFooter(view({ gh: missingGh, claude: missingClaude }))).toEqual({
      text: 'sync off · rules only',
      title: 'GitHub CLI (gh) not found\nAgent features are off: claude not found',
    });
    expect(toolsFooter(view({ claude: { state: 'limited', headline: 'Agent features are paused: Claude usage limit reached' } }))?.text).toBe('agent paused');
    expect(toolsFooter(view({ gh: { state: 'offline', headline: 'GitHub cannot be reached', detail: 'No network.' } }))?.text).toBe('GitHub unreachable');
  });
});

describe('claudeDetailUnderGh', () => {
  it('drops the toolPath hint from the claude text when the gh text already has it', () => {
    const v = view({ gh: { ...missingGh, detail: `gh is missing. ${TOOL_PATH_HINT}` }, claude: { ...missingClaude, detail: `Rules only. ${TOOL_PATH_HINT}` } });
    expect(claudeDetailUnderGh(v.gh, v.claude)).toBe('Rules only.');
  });

  it('keeps the claude text when gh is logged out and has no hint', () => {
    const v = view({ gh: { state: 'logged_out', detail: 'Log in.' }, claude: { ...missingClaude, detail: `Rules only. ${TOOL_PATH_HINT}` } });
    expect(claudeDetailUnderGh(v.gh, v.claude)).toBe(`Rules only. ${TOOL_PATH_HINT}`);
  });
});
