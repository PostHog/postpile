import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const BROWSER_AGENT_LABEL = 'com.posthog.postpile.browser';

export interface LaunchctlResult {
  ok: boolean;
  output: string;
}

export type Launchctl = (args: string[]) => LaunchctlResult;

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function browserAgentPlist(programArguments: string[]): string {
  const args = programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${BROWSER_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export function systemLaunchctl(args: string[]): LaunchctlResult {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

export interface BrowserAgentOptions {
  plistFile?: string;
  uid?: number;
  launchctl?: Launchctl;
}

export class BrowserAgent {
  readonly plistFile: string;
  private readonly domain: string;
  private readonly launchctl: Launchctl;

  constructor(options: BrowserAgentOptions = {}) {
    this.plistFile = options.plistFile ?? join(homedir(), 'Library', 'LaunchAgents', `${BROWSER_AGENT_LABEL}.plist`);
    this.domain = `gui/${options.uid ?? process.getuid?.() ?? 0}`;
    this.launchctl = options.launchctl ?? systemLaunchctl;
  }

  install(programArguments: string[]): LaunchctlResult {
    mkdirSync(dirname(this.plistFile), { recursive: true });
    writeFileSync(this.plistFile, browserAgentPlist(programArguments));
    this.launchctl(['bootout', `${this.domain}/${BROWSER_AGENT_LABEL}`]);
    return this.launchctl(['bootstrap', this.domain, this.plistFile]);
  }

  remove(): boolean {
    const installed = existsSync(this.plistFile);
    this.launchctl(['bootout', `${this.domain}/${BROWSER_AGENT_LABEL}`]);
    rmSync(this.plistFile, { force: true });
    return installed;
  }

  restart(): LaunchctlResult {
    return this.launchctl(['kickstart', '-k', `${this.domain}/${BROWSER_AGENT_LABEL}`]);
  }
}
