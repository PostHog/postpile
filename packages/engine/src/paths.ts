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

/** Folders holding the app's data: the database folder and the config folder. */
export interface DataDirs {
  dataDir: string;
  configDir: string;
}

export const DATABASE_FILE_NAME = 'db.sqlite';

export function systemPathEnv(): PathEnv {
  return { env: process.env, platform: process.platform, home: homedir() };
}

function dataDirFor(appFolder: { mac: string; xdg: string }, { env, platform, home }: PathEnv): string {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', appFolder.mac);
  }
  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(dataHome, appFolder.xdg);
}

function configDirFor(folder: string, { env, home }: PathEnv): string {
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  return join(configHome, folder);
}

/** Where PostPile keeps its data by default. */
export function dataDirs(pathEnv: PathEnv = systemPathEnv()): DataDirs {
  return {
    dataDir: dataDirFor({ mac: 'PostPile', xdg: 'postpile' }, pathEnv),
    configDir: configDirFor('postpile', pathEnv),
  };
}

/**
 * Where the app kept its data while it was called code-manager (until
 * 2026-09-28). Only the startup migration reads these.
 */
export function legacyDataDirs(pathEnv: PathEnv = systemPathEnv()): DataDirs {
  return {
    dataDir: dataDirFor({ mac: 'code-manager', xdg: 'code-manager' }, pathEnv),
    configDir: configDirFor('code-manager', pathEnv),
  };
}

/**
 * The CLI and the desktop app use the same locations so both see the same
 * data. POSTPILE_DB overrides the database path, POSTPILE_INSTRUCTIONS
 * the instructions file.
 */
export function defaultPaths(pathEnv: PathEnv = systemPathEnv()): AppPaths {
  const dirs = dataDirs(pathEnv);
  return {
    instructionsFile: pathEnv.env.POSTPILE_INSTRUCTIONS || join(dirs.configDir, 'instructions.md'),
    databaseFile: pathEnv.env.POSTPILE_DB || join(dirs.dataDir, DATABASE_FILE_NAME),
  };
}

const LEGACY_ENV_PREFIX = 'CODE_MANAGER_';
const ENV_PREFIX = 'POSTPILE_';
let legacyEnvWarned = false;

/**
 * Transition for the rename to PostPile: every CODE_MANAGER_* variable is
 * copied to its POSTPILE_* name unless that one is set too. This is the only
 * place that reads the old names. Call it first thing in each entry point
 * (server, desktop, CLI). Logs one deprecation line per process.
 */
export function applyLegacyEnv(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.warn): string[] {
  const copied: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(LEGACY_ENV_PREFIX) || value === undefined) {
      continue;
    }
    const newName = ENV_PREFIX + name.slice(LEGACY_ENV_PREFIX.length);
    if (env[newName] === undefined) {
      env[newName] = value;
      copied.push(name);
    }
  }
  if (copied.length > 0 && !legacyEnvWarned) {
    legacyEnvWarned = true;
    log(`deprecated: ${copied.join(', ')} still work for now, rename them to POSTPILE_*`);
  }
  return copied;
}
