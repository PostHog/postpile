import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { etcPathsEntries, toolSearchPath } from '@postpile/core';
import { UserConfigFile } from './user-config.ts';

// PATH for the desktop app, built at launch without running a shell. A GUI
// launch gets launchd's short PATH. Asking the login shell for the real one
// ($SHELL -ilc, what fix-path did) ran the user's whole zsh setup with
// PostPile as the responsible process, and macOS asked for privacy
// permissions for whatever that setup touched. Plain file reads instead:
// /etc/paths and /etc/paths.d (not privacy protected) plus toolPath from
// config.json.

/** A file's text, or '' when it cannot be read. */
function readOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The folders path_helper would add: /etc/paths, then each /etc/paths.d file in name order. */
export function systemPathDirs(etcDir = '/etc'): string[] {
  const dirs = etcPathsEntries(readOrEmpty(join(etcDir, 'paths')));
  let names: string[] = [];
  try {
    names = readdirSync(join(etcDir, 'paths.d')).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    dirs.push(...etcPathsEntries(readOrEmpty(join(etcDir, 'paths.d', name))));
  }
  return dirs;
}

export interface LaunchToolPathOptions {
  /** The PATH the process started with. */
  envPath: string;
  home: string;
  /** config.json with the optional toolPath list. */
  configFile: string;
  /** Where paths and paths.d live. Tests point it at a temp folder. */
  etcDir?: string;
  log?: (message: string) => void;
}

/** The PATH gh and claude are looked up in: toolPath, the start PATH, /etc/paths(.d), the usual install folders. */
export function launchToolPath(options: LaunchToolPathOptions): string {
  const config = new UserConfigFile(options.configFile, options.log).read();
  return toolSearchPath({
    toolPath: config.toolPath ?? [],
    envPath: options.envPath,
    systemDirs: systemPathDirs(options.etcDir),
    home: options.home,
  });
}
