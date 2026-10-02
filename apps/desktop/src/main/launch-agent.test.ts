import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_AGENT_LABEL, BrowserAgent, browserAgentPlist } from './launch-agent.ts';

const dirs: string[] = [];

function agent(answers: Record<string, boolean> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-agent-'));
  dirs.push(dir);
  const calls: string[] = [];
  const plistFile = join(dir, 'LaunchAgents', `${BROWSER_AGENT_LABEL}.plist`);
  const browserAgent = new BrowserAgent({
    plistFile,
    uid: 501,
    launchctl: (args) => {
      calls.push(args.join(' '));
      return { ok: answers[args[0]!] ?? true, output: '' };
    },
  });
  return { browserAgent, calls, plistFile };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the browser LaunchAgent', () => {
  it('runs the app’s postpile command at load and keeps it alive, with escaped paths', () => {
    const plist = browserAgentPlist(['/Applications/Post & Pile.app/Contents/Resources/postpile', 'browser']);
    expect(plist).toContain(`<string>${BROWSER_AGENT_LABEL}</string>`);
    expect(plist).toContain('<string>/Applications/Post &amp; Pile.app/Contents/Resources/postpile</string>\n    <string>browser</string>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it('writes the plist, unloads an older copy, then bootstraps it in the user session', () => {
    const { browserAgent, calls, plistFile } = agent({ bootout: false });
    expect(browserAgent.install(['/A.app/Contents/Resources/postpile', 'browser']).ok).toBe(true);
    expect(readFileSync(plistFile, 'utf8')).toContain('/A.app/Contents/Resources/postpile');
    expect(calls).toEqual([`bootout gui/501/${BROWSER_AGENT_LABEL}`, `bootstrap gui/501 ${plistFile}`]);
  });

  it('stops and removes it, saying whether it was there', () => {
    const { browserAgent, calls } = agent();
    expect(browserAgent.remove()).toBe(false);
    browserAgent.install(['/A.app/Contents/Resources/postpile', 'browser']);
    expect(browserAgent.remove()).toBe(true);
    expect(calls.at(-1)).toBe(`bootout gui/501/${BROWSER_AGENT_LABEL}`);
  });

  it('restarts it with kickstart, and reports when it is not loaded', () => {
    const { browserAgent, calls } = agent({ kickstart: false });
    expect(browserAgent.restart().ok).toBe(false);
    expect(calls).toEqual([`kickstart -k gui/501/${BROWSER_AGENT_LABEL}`]);
  });
});
