import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppPaths {
  /** General instructions, included in every prompt. Absent file means none. */
  instructionsFile: string;
  databaseFile: string;
}

/**
 * XDG-style locations, shared by the CLI and the desktop app so both see the
 * same data. CODE_MANAGER_DB overrides the database path.
 */
export function defaultPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return {
    instructionsFile: join(configHome, 'code-manager', 'instructions.md'),
    databaseFile: env.CODE_MANAGER_DB || join(dataHome, 'code-manager', 'code-manager.db'),
  };
}
