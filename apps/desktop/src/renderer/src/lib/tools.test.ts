import { describe, expect, it } from 'vitest';
import type { ToolsView } from '@postpile/core';
import { TOOL_PATH_HINT } from '@postpile/core';
import { agentOffReason, checkLine, claudeDetailUnderGh, retryLine, syncOffStatus, toolsFooter, toolsNotice, toolsRefetchMs } from './tools.ts';

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
    expect(checkLine(checked, now)).toBe('Checked 2m ago. Checks again at 15:17.');
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
      title: 'GitHub CLI (gh) not found\nAgent features are off: claude not found. Tiles and notifications still work on rules; topics, dossiers and glances wait.',
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

// Bug hunt MEM-A-11 / OPS-A-13: agent-only controls are disabled with this as their tooltip.
describe('agentOffReason', () => {
  const now = new Date('2026-10-10T22:00:00');
  it('is null while the agent is on or before the status loaded', () => {
    expect(agentOffReason(view(), now)).toBeNull();
    expect(agentOffReason(undefined, now)).toBeNull();
  });

  it('gives the headline and when the agent is tried again', () => {
    const paused = { ...view({ claude: { state: 'limited', headline: 'Agent features are paused: Claude usage limit reached', retryAt: '2026-10-10T22:25:00' } }), agentOn: false };
    expect(agentOffReason(paused, now)).toBe('Agent features are paused: Claude usage limit reached. Trying again at 22:25, in 25 min.');
    const missing = { ...view({ claude: { state: 'missing', headline: 'Agent features are off: claude not found' } }), agentOn: false };
    expect(agentOffReason(missing, now)).toBe('Agent features are off: claude not found.');
  });
});

describe('syncOffStatus', () => {
  it('names gh alone, or gh and claude when claude is broken too', () => {
    expect(syncOffStatus(view({ gh: missingGh })).text).toBe('gh needs a fix');
    expect(syncOffStatus(view({ gh: missingGh, claude: missingClaude })).text).toBe('gh and claude need a fix');
    expect(syncOffStatus(view({ gh: missingGh, claude: { state: 'logged_out' } })).text).toBe('gh and claude need a fix');
    expect(syncOffStatus(view({ gh: missingGh, claude: missingClaude })).title).toContain('Agent features are off: claude not found');
  });

  it('leaves a usage limit to the footer: it ends by itself', () => {
    expect(syncOffStatus(view({ gh: missingGh, claude: { state: 'limited' } })).text).toBe('gh needs a fix');
  });
});
