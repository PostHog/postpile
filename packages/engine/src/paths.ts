import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AppPaths {
  /** General instructions, included in every prompt. Absent file means none. */
  instructionsFile: string;
  databaseFile: string;
  /** The user's settings (config.json). Missing: the engine uses none (tests). */
  configFile?: string;
  /** Random install id for telemetry before the viewer is known (aliased to the hashed GitHub id once it is). Missing: a fresh id every process (tests, no-lock reads). */
  telemetryIdFile?: string;
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
export const USER_CONFIG_FILE_NAME = 'config.json';
export const TELEMETRY_ID_FILE_NAME = 'telemetry-id';

/**
 * Which data a process uses. dev: a separate folder (PostPile-dev,
 * postpile-dev), so dev runs never touch the real database. Set by
 * POSTPILE_PROFILE=dev, which the repo's dev scripts default to and the
 * unpackaged desktop app sets itself. The packaged app runs as default.
 */
export type Profile = 'default' | 'dev';

export function profileFromEnv(env: NodeJS.ProcessEnv): Profile {
  return env.POSTPILE_PROFILE === 'dev' ? 'dev' : 'default';
}

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

/** Where the packaged app keeps its data: the real database, whatever the profile. */
export function realDataDirs(pathEnv: PathEnv = systemPathEnv()): DataDirs {
  return {
    dataDir: dataDirFor({ mac: 'PostPile', xdg: 'postpile' }, pathEnv),
    configDir: configDirFor('postpile', pathEnv),
  };
}

/** Where this process keeps its data by default: the real folders, or the dev ones under POSTPILE_PROFILE=dev. */
export function dataDirs(pathEnv: PathEnv = systemPathEnv()): DataDirs {
  if (profileFromEnv(pathEnv.env) === 'dev') {
    return {
      dataDir: dataDirFor({ mac: 'PostPile-dev', xdg: 'postpile-dev' }, pathEnv),
      configDir: configDirFor('postpile-dev', pathEnv),
    };
  }
  return realDataDirs(pathEnv);
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
 * The CLI and the desktop app use the same locations for the same profile,
 * so both see the same data. POSTPILE_DATA_DIR overrides the data folder,
 * POSTPILE_DB the database file itself, POSTPILE_INSTRUCTIONS the
 * instructions file.
 */
export function defaultPaths(pathEnv: PathEnv = systemPathEnv()): AppPaths {
  const dirs = dataDirs(pathEnv);
  const dataDir = pathEnv.env.POSTPILE_DATA_DIR || dirs.dataDir;
  return {
    instructionsFile: pathEnv.env.POSTPILE_INSTRUCTIONS || join(dirs.configDir, 'instructions.md'),
    databaseFile: pathEnv.env.POSTPILE_DB || join(dataDir, DATABASE_FILE_NAME),
    configFile: join(dirs.configDir, USER_CONFIG_FILE_NAME),
    telemetryIdFile: join(dirs.configDir, TELEMETRY_ID_FILE_NAME),
  };
}

/**
 * The folder every gh and claude process runs in: an empty one the app owns,
 * next to the database. A child that inherits / or a repo as its folder may
 * read project files there (claude looks for settings and CLAUDE.md), and
 * macOS asks for privacy permissions in PostPile's name. Created on demand.
 */
export function agentCwdFor(databaseFile: string): string {
  const dir = join(dirname(databaseFile), 'agent-cwd');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The first dev run gets a copy of the real instructions.md, once: only
 * when the dev config folder does not exist yet. A copy, never a link, so
 * dev edits stay in dev. Returns the file it seeded, or null.
 */
export function seedDevInstructions(pathEnv: PathEnv = systemPathEnv()): string | null {
  if (profileFromEnv(pathEnv.env) !== 'dev' || pathEnv.env.POSTPILE_INSTRUCTIONS) {
    return null;
  }
  const devFile = defaultPaths(pathEnv).instructionsFile;
  if (existsSync(dirname(devFile))) {
    return null;
  }
  mkdirSync(dirname(devFile), { recursive: true });
  const realFile = join(realDataDirs(pathEnv).configDir, 'instructions.md');
  if (!existsSync(realFile)) {
    return null;
  }
  copyFileSync(realFile, devFile);
  return devFile;
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
