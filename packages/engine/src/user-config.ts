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

  /** The settings; a missing or broken file counts as empty (a broken one is logged). */
  read(): UserConfigData {
    let raw: Record<string, unknown>;
    try {
      raw = this.readRaw();
    } catch (error) {
      this.log(`ignoring ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
    const sweepSkip = raw.sweepSkip === undefined ? null : stringList(raw.sweepSkip);
    if (raw.sweepSkip !== undefined && sweepSkip === null) {
      this.log(`ignoring sweepSkip in ${this.path}: not a list of strings`);
    }
    return sweepSkip === null ? {} : { sweepSkip };
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
