import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// The user's own settings file, next to instructions.md:
// ~/.config/postpile/config.json (dev profile: ~/.config/postpile-dev/), see
// defaultPaths.
// Read on use, so an edit by hand counts without a restart. A packaged app
// launched from Finder gets no shell environment, so settings that must
// hold there live here, not in env vars.

/** What the file may hold. Unknown keys are kept as they are when the app writes it. */
export interface UserConfigData {
  /** Project folders the work context sweep never reads (see SweepSkipList). */
  sweepSkip?: string[];
  /**
   * Extra folders to look for gh and claude in, before everything else
   * (mise or asdf shims, a custom install). Read once at app launch.
   */
  toolPath?: string[];
}

/** A list of strings, trimmed, empties dropped; null when the value is not a list of strings. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null;
  }
  return value.map((item) => item.trim()).filter((item) => item !== '');
}

export class UserConfigFile {
  constructor(
    readonly path: string,
    private readonly log: (message: string) => void = (message) => console.log(message),
  ) {}

  /** The raw JSON object. Missing file: {}. Throws when the file is not a JSON object, so a write never clobbers it. */
  private readRaw(): Record<string, unknown> {
    if (!existsSync(this.path)) {
      return {};
    }
    const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${this.path} is not a JSON object`);
    }
    return parsed as Record<string, unknown>;
  }

  /** A list-of-strings setting; null when absent or not a list of strings (that one is logged). */
  private listSetting(raw: Record<string, unknown>, key: keyof UserConfigData): string[] | null {
    if (raw[key] === undefined) {
      return null;
    }
    const list = stringList(raw[key]);
    if (list === null) {
      this.log(`ignoring ${key} in ${this.path}: not a list of strings`);
    }
    return list;
  }

  /** The settings; a missing or broken file counts as empty (a broken one is logged). */
  read(): UserConfigData {
    let raw: Record<string, unknown>;
    try {
      raw = this.readRaw();
    } catch (error) {
      this.log(`ignoring ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
    const data: UserConfigData = {};
    const sweepSkip = this.listSetting(raw, 'sweepSkip');
    if (sweepSkip !== null) {
      data.sweepSkip = sweepSkip;
    }
    const toolPath = this.listSetting(raw, 'toolPath');
    if (toolPath !== null) {
      data.toolPath = toolPath;
    }
    return data;
  }

  /** Writes the sweep skip list, keeping every other key. Written to a temp file first, then moved into place. */
  setSweepSkip(patterns: string[]): void {
    const next = { ...this.readRaw(), sweepSkip: stringList(patterns) ?? [] };
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(temp, this.path);
  }
}
