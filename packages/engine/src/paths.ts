import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppPaths {
  /** General instructions, included in every prompt. Absent file means none. */
  instructionsFile: string;
  databaseFile: string;
}

export interface PathEnv {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
}

function defaultDatabaseFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'code-manager', 'db.sqlite');
  }
  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(dataHome, 'code-manager', 'db.sqlite');
}

/**
 * The CLI and the desktop app use the same locations so both see the same
 * data. CODE_MANAGER_DB overrides the database path, CODE_MANAGER_INSTRUCTIONS
 * the instructions file.
 */
export function defaultPaths(
  { env, platform, home }: PathEnv = { env: process.env, platform: process.platform, home: homedir() },
): AppPaths {
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  return {
    instructionsFile: env.CODE_MANAGER_INSTRUCTIONS || join(configHome, 'code-manager', 'instructions.md'),
    databaseFile: env.CODE_MANAGER_DB || defaultDatabaseFile(platform, env, home),
  };
}
